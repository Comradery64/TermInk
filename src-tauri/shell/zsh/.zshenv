# TermPaper shell integration shim: run the user's real zsh startup, then add OSC 133 marks.
TERMPAPER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${TERMPAPER_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR="$TERMPAPER_ZDOTDIR"
