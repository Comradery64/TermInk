TERMINK_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${TERMINK_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zprofile" && -o login ]] && source "$ZDOTDIR/.zprofile"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
# leave ZDOTDIR pointing at the user's dir so nested shells/tools behave
unset TERMINK_ZDOTDIR

autoload -Uz add-zsh-hook
__termink_preexec() { printf '\e]133;C\a' }   # output start
add-zsh-hook preexec __termink_preexec
# A = prompt start, B = command input start. Both live inside PS1 so zsh's own
# SGR reset (emitted between precmd and the prompt) cannot cancel the ink.
PS1="%{$(printf '\e]133;A\a')%}${PS1}%{$(printf '\e]133;B\a')%}"

# zsh paints pasted/yanked text in standout until the next key (Cmd+V and
# Ctrl+Y both count as paste); on the panel it reads as a stray inverse block.
zle_highlight=("${(@)zle_highlight:#paste:*}" paste:none)
# completion's trailing "/" is bold by default; in a face with a real bold it
# reads as a different character, so keep it in plain ink
zle_highlight=("${(@)zle_highlight:#suffix:*}" suffix:none)
