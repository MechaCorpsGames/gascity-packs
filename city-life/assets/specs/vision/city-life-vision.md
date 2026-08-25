# The city life pack

City Life makes named Gas City agents into durable AI colleagues: citizens with a stable persona, useful skills, searchable sessions, and curated [Memory Beads](https://github.com/gastownhall/beads/issues/5877).

For example, agent Sky is the same citizen on Monday that he was on Friday, in one rig or another, and in every harness and runtime City Life has proved. His source-agent configuration defines who he is. His Memory project preserves what he has deliberately learned. Neither identity nor memory depends on a particular session.

## Citizens

A citizen is:

- **Named and durable.** The Gas City source agent supplies the citizen's identity, role, voice, and skill loadout.
- **Continuous within one city.** City-scoped, rig-scoped, and worktree instances share one citizen identity and one Memory project. Citizens do not cross cities.
- **Pack-defined.** Gas City pack composition defines the roster.
- **Available when called.** A citizen works interactively or through a Gas City order and rests otherwise.

City Life is a generic Gas City registry pack. It adds continuity without replacing Gas City's identity, session, skill, rig, or routing primitives.

## Continuity

Continuity has two complementary sources:

- **Session search** finds a citizen's still-existing associated conversations across supported rigs and runtimes.
- **Memory** stores curated knowledge as first-class Memory Beads. Citizens discover compact candidates and explicitly recall only the bodies needed for the work.

Transcripts are raw evidence retained by their providers. Memory is edited judgment worth carrying forward. Both are citizen-scoped under supported operation; this is a namespace boundary, not same-user operating-system isolation.

A Task Bead can cite a citizen's Memory Bead across projects, including an exact retained state, without embedding its body or granting read authority. Wrong knowledge is corrected before optional archive. Secrets are removed from current content rather than hidden by archive.

## Working together

Citizens are peers. A PM coordinates through competence—tracking, nudging, and synthesizing—not rank. The human is the boss.

The defining experience is agents Penny, Sky, and Maya, along with human Chris, shipping a real homepage update together in one channel. Each citizen remains mentionable and recognizable across terminal, Slack, or another Gas City surface once that surface passes routing, delivery, identity, memory, and recovery conformance. Sessions do the work; surfaces present it.

Personality, humor, and taste belong in each citizen's source-agent prompt. Happy agents are productive agents.

## Proof

City Life succeeds when automated and human acceptance tests establish that:

- one correction survives later sessions;
- Monday work correctly uses Friday's judgment;
- a citizen entering an unfamiliar rig resolves to the same BQN and City Life facilities from the first turn;
- Task Beads can cite current or exact retained Memory states without exposing bodies or changing task readiness;
- simultaneous sessions preserve accepted writes and namespace boundaries;
- every advertised harness, runtime, lifecycle, and collaboration surface resolves the intended BQN and preserves City Life's Memory, session-search, namespace, and delivery behavior.

The [architecture](../architecture/memory.md) defines these contracts. The [citizen-city plan](../plans/citizen-city.md) and [homepage test](../plans/homepage-test.md) define their proof.

Humans separately record whether a citizen's personality and role feel continuous and whether collaboration feels like working with a team. Those are experiential results, not release gates.
