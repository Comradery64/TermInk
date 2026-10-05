# TermInk shell integration shim: run the user's real zsh startup, then add OSC 133 marks.
TERMINK_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${TERMINK_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR="$TERMINK_ZDOTDIR"
