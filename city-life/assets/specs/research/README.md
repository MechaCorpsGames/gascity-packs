# Research evidence notes

These reports retain implementation observations that inform the [City Life vision](../vision/city-life-vision.md) and [Memory-Beads-native architecture](../architecture/memory.md). The architecture and the upstream [Memory Beads proposal](https://github.com/gastownhall/beads/issues/5877) are the design authorities; these snapshots are evidence, not requirements.

Each report separates observed behavior from its implication for City Life. Product counts and versions are included only where they explain the observed behavior.

| Report | Durable evidence |
|---|---|
| [agent-framework-memory.md](agent-framework-memory.md) | Persona and memory are separate; startup context needs explicit budgets; capture opportunities vary by runtime |
| [agentic-memory-landscape.md](agentic-memory-landscape.md) | Progressive disclosure works; automatic extraction and semantic ranking should not become canonical memory |
| [cass-and-cass-memory.md](cass-and-cass-memory.md) | Session readers are provider-specific; session search and curated memory are different systems |
| [gbrain.md](gbrain.md) | Shared-brain aggregation and per-citizen ownership are different products |
| [gstack.md](gstack.md) | Roles are not identities; bounded recall and explicit correction/archive verbs reduce context bloat |
| [block-berd-character.md](block-berd-character.md) | Character comes from prompt and capability; memory writes should be deliberate |
| [gascity-no-upstream-changes-feasibility.md](gascity-no-upstream-changes-feasibility.md) | Constrained support rows can implement City Life without Gas City changes; public Task and delivery seams would reduce adapter coupling |
| [paperclip-agent-org.md](paperclip-agent-org.md) | Source-agent identity, prompt, skills, task routing, and session-resume evidence need distinct owners |

Additional private-source research is distilled into the architecture rather than reproduced here.
