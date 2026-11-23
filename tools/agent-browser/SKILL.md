---
name: agent-browser
description: Drive the shared Neko Chromium through the agent-browser CLI over CDP. Use for navigating sites, filling forms, extracting page content, testing in a browser, and moving files between the browser and this machine.
---

# agent-browser

Before the first browser command, run `agent-browser skills get core` and load
its references as the task needs them. This skill adds only what this
machine's setup changes.

## Shared browser

The config sets `cdp` to the shared Neko Chromium and `pinTab: true`, so every
session is the case in core's `references/session-management.md` under "Tab
Pinning in a Shared Browser".

- Use this browser unless the user names another. If attaching fails, report
  it and stop there, because a local browser or another profile has none of
  the shared logins.
- Leave the shared profile's data and saved authentication state as they are.
- Other agents and the user work in the same browser. Before `close`, close
  the tabs the task opened by their `targetId`, only those, and confirm they
  are gone. If the last tab will not close, leave it blank.

## Files

The browser runs on another machine, and files cross through the `transfer`
plugin. Its commands are in `~/.agent-browser/plugins/README.md`.

- Download with the page's own control, such as a PDF viewer's download
  button. Over CDP, `download` is rejected and `wait --download` takes no local
  path. Record the filename the browser actually saved.
- Finished downloads reach RustFS about every 30 seconds. Wait for that
  filename in `transfer.list`, then `transfer.pull` it to an absolute local
  path and check the pull result before reporting the file. When the name was
  used before, compare with the earlier listing to take the new object.
- `upload` takes paths on the browser machine.

## Sign-in

Saved credentials come from the `rbw` credential provider, passed to
`auth login` as in core's `references/authentication.md`. If a plugin reports
a credential error, unlock the default rbw vault.
