# I set a token cap. DeepSeek returned 200 OK and generated 5× my limit.

### Measuring the cost of "reasoning on by default" in DeepSeek V4-Pro (official release)

> ⚠️ **This article was written by an AI** (Claude). Every number below comes from real API receipts
> collected by the author on 2026-08-14 against DeepSeek's official endpoint, model `deepseek-v4-pro`
> (the V4-Pro-0813 release). Sample sizes are stated inline. The author is an independent developer
> with no affiliation to DeepSeek or OpenRouter.

---

## TL;DR

- **Reasoning is on by default.** Send no reasoning parameters at all, and one Liar's Dice decision burns 3,072 output tokens — **all of it reasoning, zero characters of actual answer**.
- **The OpenAI-standard fix is silently ignored.** I sent `max_completion_tokens: 3072`. It returned HTTP 200 and then generated **15,809 tokens** over **222 seconds**. Not an error. It just didn't look.
- **A parameter I made up is also accepted.** I sent `totally_bogus_param: true`. HTTP 200. **This API silently swallows unknown parameters** — which means "I set a limit" is unverifiable. You find out from the bill.
- **Same task, reasoning off: 2 seconds, 95 output tokens.** Reasoning on: 65 seconds, ~4,500 tokens. **The answers are the same length.**
- **Cost per *usable* answer**: $0.0015 with reasoning off; **$0.0247 (16.7×)** with reasoning on at an 8,192 budget; **unbounded** at 3,072 — zero usable answers, full price paid.
- **Is the official release better than the old quantized build?** On one zero-ambiguity blunder metric, **no measurable improvement** (1/71 vs 2/22, not significant, small sample).
- **How to turn it off**: `reasoning_effort: "none"` or `thinking: {type: "disabled"}` work. `enable_thinking: false` does **not** — and nothing tells you.

---

## Why I was measuring this at all

I build **《开！》("KAI!")**, a single-player Liar's Dice game where the opponent is an LLM. It plays through the same engine interface you do — same information, same actions, same settlement — states its reasoning before calling you out, and keeps a profile on how you play across sessions. The model is swappable: change the model and you have changed opponents.

Which means I need to know, per model, what one move costs and how long it takes. **This isn't benchmark curiosity. It's a bill-and-latency problem.**

Then I hit this wall.

## The wall: you pay, and you get an empty string

One decision prompt is about 3,200 Chinese characters (~3,300 input tokens). With `max_tokens: 3072`, three out of three calls died:

```
finish=length  completion=3071  reasoning=3071  body=0 chars  50s
finish=length  completion=3072  reasoning=3072  body=0 chars  47s
finish=length  completion=3072  reasoning=3072  body=0 chars  42s
⇒ usable: 0/3
```

**Every output token went to reasoning. The answer never got a turn.** Billing is by tokens actually generated, so all three were paid for in full, and all three returned empty strings.

What makes this worse is how it presents downstream: the model returns no parsable action → my fallback logic marks the turn non-compliant → a table in my dashboard reports **"this model fails to follow the contract on 94.4% of turns."** (That figure is from this project's 2026-08-13 batch, not from today's measurements.) **I nearly filed a real budget bug as a character flaw in the model.**

## So how much budget does it actually need?

Same prompt, four configurations, three calls each:

| Configuration | Usable | Completion tokens | Reasoning share | Answer body | Latency |
|---|---|---|---|---|---|
| Reasoning on · `max_tokens`=3072 | **0/3** | 3071–3072 | 100% | **0 chars** | 42–50s |
| Reasoning on · 8192 | **1/3** | 7837–8192 | ~95% | 0 / 118 chars | 121–126s |
| Reasoning on · 32768 | 3/3 | 3220–5785 | ~97% | 117–140 chars | 49–82s |
| **Reasoning off** · 3072 | **3/3** | **84–107** | — | 123–156 chars | **2–4s** |

Three things are true at once:

**1. The tighter the budget, the more reliably it burns right up to the ceiling.** Give 3,072 and it spends 3,072 (3 of 3). Give 8,192 and it mostly spends 8,192 (2 of 3 hit the ceiling; one stopped on its own at 7,837). Only at 32,768 — far above the 3,200–5,800 it actually needs — does it stop naturally every time.

**2. Reasoning length is not budgetable.** On one fixed prompt, reasoning tokens ranged **3,137–5,691**. With no effective cap it reached **15,774**. That's not "thinks a lot," that's **you cannot size a budget for it**. Which number would you configure against?

**3. All that thinking does not produce a longer answer.** Reasoning off: 123–156 characters of answer. Reasoning on: 117–140. **The extra 47× in tokens and 22× in latency bought no additional output.**

For my application there's a fourth, fatal one: a round of this game is budgeted at **30–60 seconds total**, and one reasoning-mode move takes 49–222 seconds. **That isn't expensive. That's a product that doesn't exist.**

## Is this the OpenAI protocol's fault, or DeepSeek's?

I tested this specific question before publishing. The answer is **both — but not evenly**.

**The protocol's share.** In the OpenAI-compatible Chat Completions API, `max_tokens` puts reasoning and answer in one shared budget; overrun leaves you empty-handed. OpenAI's own reasoning models have this hazard — which is exactly why they introduced `max_completion_tokens` and explicitly warn in their docs that too small a limit yields an empty response. **That half is a protocol design problem, not a DeepSeek problem.**

**DeepSeek's share**, parameter by parameter:

| What I sent | What should happen | **What actually happened** |
|---|---|---|
| *nothing* | — | **Reasoning on by default**, budget consumed |
| `max_completion_tokens: 3072` | OpenAI's standard remedy | **Silently ignored**: 15,809 tokens, 222s |
| `reasoning: {max_tokens: 1024}` | OpenRouter's convention | **Silently ignored** |
| `reasoning_effort: "none"` | disable reasoning | ✅ works (18 tokens, 1s) |
| `thinking: {type: "disabled"}` | disable reasoning | ✅ works (18 tokens, 1s) |
| `enable_thinking: false` | disable reasoning | **Silently ignored** |
| `chat_template_kwargs: {…}` | disable reasoning | **Silently ignored** |
| `totally_bogus_param: true` *(I invented this)* | should 400 | **HTTP 200, silently swallowed** |

That last row is the root of everything above it. **This API accepts unknown parameters without complaint**, so every "silently ignored" in the table is indistinguishable from "successfully configured." You send a cap, you get a 200, you believe you're capped — **until the invoice says otherwise**.

The sharpest case is `max_completion_tokens`. That parameter exists specifically to solve the problem this article is about. DeepSeek accepts it, returns 200, and lets the model generate 15,809 tokens anyway. **Returning an error would be fine. Silently ignoring it is the worst available behavior.**

My conclusion: **the protocol dug the hole; DeepSeek made it deeper and removed the ladder.**

## But surely the official release is *better*?

This is where I most wanted to give it a win, and the data wouldn't cooperate.

**On price, one thing is easy to get wrong.** On OpenRouter, the older `deepseek-v4-pro` lists at $1.17/$2.34 per million; the official release `-0813` lists at $0.43/$0.87; direct from DeepSeek it's ¥3/¥6 (≈$0.42/$0.85). That *looks* like a two-thirds price cut. But OpenRouter has always carried a premium on older deployments, and I can't separate channel markup from an actual price change. **So I won't claim the official release got more expensive.**

**What did go up is the cost per usable answer**: $0.0015 per move with reasoning off; at an 8,192 budget only one call in three is usable, so counting the two wasted calls it's **$0.0247 per usable move — 16.7×**; at 3,072 it's unbounded, because nothing is usable and everything is billed. **Whatever happened to the list price gets eaten by that multiplier.**

**On play quality**, I compared the two builds on a metric with zero room for interpretation. In Liar's Dice, a bid claims "there are at least N dice showing X *on the whole table*." Sometimes the model's own hand already satisfies the current bid — at which point challenging it is a **guaranteed loss**, no strategy involved. How often does it challenge anyway?

| Build | Such situations | Blunders | Rate |
|---|---|---|---|
| Old (OpenRouter, quantized) | 71 | 1 | **1%** |
| Official 0813 (direct) | 22 | 2 | **9%** |

**z = 1.22 — not significant.** So the honest statement is not "the official release is worse," but: **there is no measurable improvement on this metric, and if there is a difference at all, it points the wrong way.**

Two caveats that matter: the builds **never played in the same batch** (this is a cross-batch comparison, mixing different opponents, seeds, and prompt versions), and the official release only has 22 such situations. **This is enough to falsify "clearly stronger." It is not enough to establish "weaker."**

## Conclusion

This is not "DeepSeek is bad." With reasoning off, V4-Pro returns a clean decision in 2 seconds for a fraction of a cent, and it plays well at my table — **my hosted seat still runs DeepSeek today**.

The problem is three product decisions stacked on top of each other:

1. **Reasoning on by default** — for a per-call application, that's a tax, not a gift;
2. **No working cap on the reasoning budget** — neither OpenAI's parameter nor OpenRouter's is honored;
3. **Unknown parameters are silently swallowed** — which makes the first two **undiagnosable**.

The third is the one worth fixing. **An API that errors lets a developer find the problem in ten minutes. An API that silently returns 200 makes them reverse-engineer it from an invoice and a bogus "94.4% non-compliant" statistic.**

If you're calling it per-request: **send `reasoning_effort: "none"` explicitly** (or `thinking: {type: "disabled"}`). Don't use `enable_thinking: false` — it does nothing, and it won't tell you.

---

*《开！》is a single-player Liar's Dice game whose opponent computes odds, remembers your habits across sessions, and states its reasoning before calling you out. Every number in this article came out of its model-selection work.*
