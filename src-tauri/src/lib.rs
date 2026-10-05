use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
struct PtyState(Mutex<Option<Pty>>);

#[tauri::command]
fn spawn(state: State<PtyState>, cols: u16, rows: u16, on_data: Channel<Vec<u8>>) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) { "powershell.exe".into() } else { "/bin/sh".into() }
    });
    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("TERM_PROGRAM", "TermPaper");
    if shell.ends_with("zsh") {
        if let Ok(dir) = install_zsh_integration() {
            if let Some(user) = std::env::var_os("ZDOTDIR") {
                cmd.env("TERMPAPER_USER_ZDOTDIR", user);
            }
            cmd.env("ZDOTDIR", dir);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        cmd.cwd(home);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || on_data.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    // a frontend reload calls spawn again: end the previous shell instead of orphaning it
    if let Some(mut old) = state.0.lock().unwrap().take() {
        let _ = old.child.kill();
    }
    *state.0.lock().unwrap() = Some(Pty { master: pair.master, writer, child });
    Ok(())
}

#[tauri::command]
fn write(state: State<PtyState>, data: Vec<u8>) -> Result<(), String> {
    if let Some(p) = state.0.lock().unwrap().as_mut() {
        p.writer.write_all(&data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize(state: State<PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(p) = state.0.lock().unwrap().as_ref() {
        p.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Write the bundled zsh shim to a per-user dir and return it for ZDOTDIR.
fn install_zsh_integration() -> std::io::Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join("termpaper-zsh");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(".zshenv"), include_str!("../shell/zsh/.zshenv"))?;
    std::fs::write(dir.join(".zshrc"), include_str!("../shell/zsh/.zshrc"))?;
    Ok(dir)
}

pub fn run() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .setup(|app| {
            // Default menu gives Cmd+C/V/X/A and Quit on macOS.
            app.set_menu(tauri::menu::Menu::default(app.handle())?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![spawn, write, resize])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
