# Source inside the workflow test shell. Every gh call terminates here.
sleep() { :; }
gh() {
  case "$1 $2" in
    "pr view")
      case "$5" in
        state) echo OPEN ;;
        isDraft) echo false ;;
        baseRefName) echo main ;;
        state,isDraft,headRefOid,autoMergeRequest)
          printf 'OPEN\tfalse\t%s\t%s\n' "$CURRENT_HEAD" "$ARMED" ;;
        *) echo "Unexpected view fields: $5" >&2; return 2 ;;
      esac ;;
    "api repos/fixture/repo/issues/7/comments?per_page=100")
      run_id=17
      case "$VERDICT" in
        SKIP) echo '[]' ;;
        OTHER_RUN) run_id=170; verdict=PASS ;;
        BLOCK) verdict=BLOCK ;;
        *) verdict=PASS ;;
      esac
      if [ "$VERDICT" != SKIP ]; then
        printf '[{"user":{"login":"claude[bot]"},"body":"/actions/runs/%s\\nAUTOMERGE_VERDICT: %s"}]\n' "$run_id" "$verdict"
      fi ;;
    "api repos/fixture/repo/contents/.github/scripts/automerge-eligible.cjs?ref=main")
      [ "$VERDICT" != FETCH_ERROR ] || return 1
      cat .github/scripts/automerge-eligible.cjs ;;
    "pr merge")
      case " $* " in
        *" --disable-auto "*) echo disarm >> mutations ;;
        *" --auto "*" --match-head-commit $HEAD_SHA "*) echo arm >> mutations ;;
        *) return 2 ;;
      esac ;;
    *) echo "Unexpected gh command: $*" >&2; return 2 ;;
  esac
}
