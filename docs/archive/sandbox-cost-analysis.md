# Sandbox Cost Analysis & UI Decision

> Last updated: 2026-04-18
> Related: [daytona-sandbox-lifecycle.md](./daytona-sandbox-lifecycle.md)

## Decision: Read-Only Status Badge, No Manual Controls

**We do NOT add manual start/stop controls.** Instead:

1. A small, read-only status badge in the repository header
2. When Deep mode fails because sandbox is archived/gone, show a clear inline
   message with a "Re-import" action and a "switch to Quick mode" alternative
3. Keep the current auto-wake behavior as-is -- it's already the best practice

---

## Cost Model

### Daytona Billing by State

| Sandbox State | CPU | Memory | Disk | Relative Cost |
|---|---|---|---|---|
| **started** (running) | Billed | Billed | Billed | $$$ |
| **stopped** (hibernated) | Free | Free | Billed (storage only) | $ |
| **archived** | Free | Free | Free or minimal | ~0 |
| **destroyed** | Free | Free | Free | 0 |

Reference: https://www.daytona.io/pricing

### Current Config Per Sandbox

```
CPU:     2 cores
Memory:  4 GiB
Disk:    20 GiB
```

### Where Money Is Actually Spent

The sandbox is only in the expensive "started" state during:
1. The initial import (~1-3 minutes)
2. Each Deep mode execution (~5-30 seconds)
3. The 30-minute idle window after each interaction

The auto-stop at 30 minutes already handles 90% of cost optimization.

---

## Options Evaluated

### Option A: No Change
- **Cost:** Acceptable (auto-stop handles it)
- **UX:** User confused when Deep mode silently fails after 24h
- **Verdict:** The silent failure is a real problem

### Option B: Read-Only Badge + Friendly Error (CHOSEN)
- **Cost:** Zero impact (just visibility)
- **UX:** Removes the main confusion point; user knows when to re-import
- **Effort:** ~2 hours frontend, zero backend changes
- **Verdict:** Best cost-to-value ratio

### Option C: Full Manual Start/Stop
- **Cost:** Saves at most 30 min of idle billing per session (pennies)
- **UX:** Adds infrastructure concepts to a code analysis tool
- **Effort:** ~8 hours (new mutations, error handling, loading states)
- **Verdict:** Not worth the complexity

### Option D: Lazy Provisioning (on-demand sandbox)
- **Cost:** Significant savings IF many users never use Deep mode
- **UX:** Faster import, but slower first Deep mode (30-60s extra)
- **Effort:** ~16 hours (refactor import pipeline)
- **Verdict:** Defer to v2; need usage data first

---

## Badge Design

| DB Status | Display | Color | Meaning |
|---|---|---|---|
| `provisioning` | Sandbox: starting | yellow | Import in progress |
| `ready` | Sandbox: ready | green | Deep mode available |
| `stopped` (Daytona-side) | Sandbox: ready | green | Still works (auto-wake is transparent) |
| `archived` | Sandbox: expired | gray | Deep mode unavailable, re-import needed |
| `failed` | Sandbox: error | red | Something broke |
| No sandbox record | (no badge) | -- | Quick mode only |

Key: `ready` and `stopped` both show green because auto-wake makes them
identical from the user's perspective.

---

## References

| Resource | URL |
|---|---|
| Daytona Pricing | https://www.daytona.io/pricing |
| Daytona Sandbox Lifecycle | https://www.daytona.io/docs/sandbox/lifecycle |
| GitHub Codespaces Lifecycle (similar model) | https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces |
| Google Cloud Workstations Auto-Stop | https://cloud.google.com/workstations/docs/customize-workstation-configurations#auto-stop |
