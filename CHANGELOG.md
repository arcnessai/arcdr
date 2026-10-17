# Changelog

## 0.1.0

The first public release.

- **herdr-native list**: spaces and agents as herdr's sidebar shows them, read from your herdr config.
- **Answer with a tap**: permission prompts, questions, plan approval and folder trust as buttons; the screen
  is read again before the keys go out.
- **Chat**: the conversation from the transcript, sending states, `/` and `@` completion, attachments,
  diffs, a file viewer, the terminal as it is; a stop button while the agent works.
- **Mods on the phone**: a display spec places what mods report to herdr; the display editor in Settings;
  the `notify` token rings the phone; the starter mod `arcdr-report`; the `arcdr-mod` skill.
- **Desktop panes**: up to four conversations at once.
- **＋ tray**: key buttons, photos, camera, files, and your saved commands.
- **Sessions**: start, resume and close from the phone; drag agents to reorder herdr's tabs.
- **Web Push**, six themes, text size and typeface per device, four languages.
- **herdr plugin**: `herdr plugin install arcnessai/arcdr` adds panes to set it up and to open it on your
  phone with a QR code.
- **Setup**: `scripts/setup.sh` or the `arcdr-setup` skill; Tailscale identity only, loopback bind.
- **Your words stay yours**: messages are typed into the pane, not pasted, so Claude Code takes them as the
  person's own request rather than as pasted material.
- **The right conversation**: a pane shows the session of its own interactive Claude Code, even when an
  unattended job started from it reported another one to herdr.
