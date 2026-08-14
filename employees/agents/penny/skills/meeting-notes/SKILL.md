---
name: meeting-notes
description: Manage Gas City meeting notes, decisions, and TODO tracking. Use when anyone says "/meeting-notes" followed by a subcommand. Supports creating new notes from a template, scanning for open TODOs and decisions, searching across notes, and generating status summaries. Also use when asked to "take notes," "log a decision," "track a TODO," or "what's overdue."
---

# Meeting Notes

Manage meeting notes, decisions, and action items for Gas City, Inc. Notes live in the `notes/` folder at the project root.

## Commands

### `/meeting-notes new`

Create a new note file.

1. Ask the user for:
   - **Title** (e.g., "Q2 Roadmap Planning")
   - **Type** -- one of: `meeting`, `decision`, `checkin`, `planning`, `retro`, `note`
   - **Attendees** (comma-separated names)
   - **Tags** (comma-separated topic tags)
2. Generate the slug from the title: lowercase, spaces to hyphens, strip punctuation.
3. Get today's date in YYYY-MM-DD format.
4. Create the file at `notes/YYYY-MM-DD-<type>-<slug>.md` using the template in `assets/note-template.md`. Fill in Date, Type, Attendees, and Tags from user input. Set the `# Title` heading to the provided title.
5. Confirm the filename to the user and display the file for them to review or edit.

If the user provides all details inline (e.g., `/meeting-notes new "Kickoff" meeting Chris,Penny ops,kickoff`), skip prompting and create directly.

### `/meeting-notes todos`

Scan all `.md` files in `notes/` for open TODO items.

1. Use Grep to search for lines matching `- \[ \].*\*\*\[TODO\]\*\*` across all files in `notes/`.
2. Parse each match to extract: task description, owner (text after `**Owner:**`), due date (text after `**Due:**`).
3. Group results by owner.
4. Flag any items where the due date is a valid date in the past (relative to today) as **OVERDUE**.
5. Display results in a clear table or grouped list format:

```
## Open TODOs

### Chris
- [ ] Define Q2 OKRs -- Due: 2026-03-20
- [ ] **OVERDUE** Review pricing doc -- Due: 2026-03-01

### Penny
- [ ] Set up weekly standup cadence -- Due: 2026-03-15
```

If no TODOs are found, say so.

### `/meeting-notes decisions`

Scan all `.md` files in `notes/` for decisions.

1. Use Grep to search for lines matching `\*\*\[DECISION\]\*\*` across all files in `notes/`.
2. Extract the date from each filename (first 10 characters, YYYY-MM-DD format).
3. Sort results in reverse chronological order (newest first).
4. Display each decision with its source file:

```
## Decision Log

- **2026-03-12** (meeting-kickoff-with-chris.md): Adopted the notes/ folder and meeting-notes skill for institutional memory.
- **2026-03-10** (decision-pricing-model.md): Set initial pricing at $49/seat/month.
```

### `/meeting-notes search <query>`

Search across all notes for a keyword or phrase.

1. Use Grep with the user's query across all `.md` files in `notes/`, with 2 lines of context.
2. Display matching filenames and the relevant lines.
3. If no matches, say so and suggest broadening the search.

### `/meeting-notes summary`

Generate a dashboard-style overview.

1. Use Glob to count all `.md` files in `notes/` (exclude README.md).
2. Use Grep to count open TODOs (`- \[ \].*\*\*\[TODO\]\*\*`).
3. Parse due dates from TODO lines; count how many are overdue (due date before today).
4. Use Grep to find decisions; filter to those from files dated within the last 7 days.
5. Display:

```
## Notes Dashboard

- **Total notes:** 12
- **Open TODOs:** 5 (2 overdue)
- **Recent decisions (last 7 days):** 3
  - [2026-03-12] Adopted notes system (meeting-kickoff-with-chris.md)
  - [2026-03-11] Approved Q2 budget (planning-q2-budget.md)
  - [2026-03-08] Hired contractor for frontend (decision-frontend-hire.md)
```

## Notes Folder

- Path: `notes/` at project root
- Naming: `YYYY-MM-DD-<type>-<slug>.md`
- Types: `meeting`, `decision`, `checkin`, `planning`, `retro`, `note`
- Template: `assets/note-template.md` in this skill's directory
- Decisions marked with `**[DECISION]**`
- TODOs marked with `- [ ] **[TODO]** ... -- **Owner:** [name] -- **Due:** [date]`
- Completed TODOs use `- [x]` instead of `- [ ]`
