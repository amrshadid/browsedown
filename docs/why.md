# Why Browsedown exists

## The problem

Repositories are full of Markdown meant to be _read_: `docs/` folders, READMEs, decision
records, plans and runbooks. More and more of it is written by coding agents (plans, design
notes, research, changelogs), and some of it lives in folders git ignores. People still need
to read it, review it and follow its links.

Reading it today is awkward:

- **The editor's Markdown preview** shows one file at a time inside the editor, with no
  tree. Links open more editor tabs, and the styling isn't what people know from GitHub.
- **A Git host's renderer** needs a push. It can't show ignored or uncommitted files, and
  it's slow for local drafts.
- **Documentation site generators** need config, a scaffold and a build. That's too much
  to read a folder once.

What the reader wants is the ordinary experience of reading docs on the web: a tree, real
links, Back and Forward, a tab they can keep open beside the editor. That should take one
click, on exactly the folder or file they picked, and touch nothing in the repository.

## What we don't know yet

We don't know how many people want this. We haven't measured it, so we don't claim it is
common. The pilot is how we find out.

## Existing tools

We surveyed the Visual Studio Marketplace and Open VSX in November 2026 and read the
listings and, for the closest tools, their source. We didn't install them. Several tools
cover parts of the idea, for example Markdown Mirror, Markdown Forge, Markdown Live Server
and seemore. We found none that combines all of these:

- one Explorer right-click on a folder or file
- the system browser
- a sidebar tree scoped to that folder
- discovery the way git does it, while still letting you browse an ignored folder you picked
- relative links, heading anchors and browser Back/Forward working across files

The value we're testing is that combination, plus a strict security model for the local
server. New tools appear often, so we check again before each release.

## How we'll know if it works

We're running a small pilot with developers on their own repositories, including folders
written by agents. Browsedown is worth continuing if pilot users:

- get the reading view they wanted in one action, and
- keep using it instead of opening files in the editor preview or pushing to read them.

We'll also ask what they still open elsewhere. If the answer is "most things", we'll narrow
the scope or stop. We won't add features to compensate.
