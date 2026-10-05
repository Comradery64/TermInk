use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
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
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("TERM_PROGRAM", "TermPaper");
    if let Some(home) = std::env::var_os("HOME") {
        cmd.cwd(home);
    }
    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
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
    *state.0.lock().unwrap() = Some(Pty { master: pair.master, writer });
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

pub fn run() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![spawn, write, resize])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
