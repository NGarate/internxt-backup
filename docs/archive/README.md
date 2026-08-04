# Archived planning documents

These describe the pre-pivot project: a bespoke uploader that shelled out to
the Internxt CLI once per file. Their analysis was sound for that design, and
several of their conclusions are what motivated abandoning it — in particular
that `--resume` never resumed anything, and that no real end-to-end evidence
existed.

They are kept for history. **Do not plan against them.** The premises no longer
hold: the data path is now restic over rclone's native Internxt backend, so
chunk resume, retry policy, manifest signing and delete-sync safety are all
either solved upstream or no longer meaningful.

Current status: [../roadmap.md](../roadmap.md).
Why the pivot happened: [../../README.md](../../README.md).
