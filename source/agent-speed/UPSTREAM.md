# Agent Speed source

`windows/src/AgentSpeed.Core` and `spec/assets` come from
https://github.com/zoefix/agent-speed at commit `a94a67fcc78e5d8eea5f82d8d5e737bccf994e2c`.
The MIT license is in `LICENSE`; ZstdSharp.Port's license is in `ZSTDSHARP-LICENSE`.
LotusTokenDash adds `LotusSpeedBridge` and adapts `SourceLocations` and
`HistoryAnalyzer` to include its configured Codex homes. The upstream monitor
does not send conversation contents to the UI; only local measurements and
project names are used.
