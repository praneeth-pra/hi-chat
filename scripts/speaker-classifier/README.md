# Labelled speaker clips

`labeled.jsonl` holds real speaker clips from the logs, each with a `label`
of `send` or `skip`, and `more` (`yes`, `scenario` or `no`) for whether the
question is still being set up. It is the
test data for comparing judge models; the nightly routine appends the day's
clips.

The word-feature classifier trained on it was removed on 8 Oct 2026 (it
only ever logged a score and was too weak to decide anything). Its code is
in git history before that date if it is ever wanted again.
