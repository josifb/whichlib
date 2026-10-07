# whichlib

The dependency picker for coding agents: an MCP server (npm package and hosted at whichlib.com) that recommends, compares and scores GitHub repositories.

## Language

**Call counter**:
The anonymous count of tool calls, from the npm package and the hosted server, that product decisions are made from.
_Avoid_: telemetry (for the numbers themselves), analytics

**Protocol version**:
The MCP specification revision a client used for a call, as its date string (for example `2025-11-25` or `2026-07-28`).
_Avoid_: era, legacy/modern (the SDK's grouping; derive it from the protocol version when needed)
