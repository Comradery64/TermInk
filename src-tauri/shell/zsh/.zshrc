TERMPAPER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${TERMPAPER_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zprofile" && -o login ]] && source "$ZDOTDIR/.zprofile"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
# leave ZDOTDIR pointing at the user's dir so nested shells/tools behave
unset TERMPAPER_ZDOTDIR

autoload -Uz add-zsh-hook
__termpaper_preexec() { printf '\e]133;C\a' }   # output start
add-zsh-hook preexec __termpaper_preexec
# A = prompt start, B = command input start. Both live inside PS1 so zsh's own
# SGR reset (emitted between precmd and the prompt) cannot cancel the ink.
PS1="%{$(printf '\e]133;A\a')%}${PS1}%{$(printf '\e]133;B\a')%}"

# zsh paints pasted/yanked text in standout until the next key (Cmd+V and
# Ctrl+Y both count as paste); on paper that looks like a stray highlighter mark.
zle_highlight=("${(@)zle_highlight:#paste:*}" paste:none)
