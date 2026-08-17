# I Gave DeepSeek a Token Limit. It Ignored Me.

### A hands-on test of V4-Pro's default reasoning mode

> ⚠️ **This article was generated with AI assistance** (Claude). Every number comes from real calls the author made to DeepSeek's official API on the day of testing, and sample sizes are included with each conclusion. The author is an independent developer with no affiliation to DeepSeek or OpenRouter.
>
> Tested on 2026-08-14 using `deepseek-v4-pro` on DeepSeek's official endpoint (the production V4-Pro-0813 release).

---

## TL;DR

- **Reasoning is on by default.** With no reasoning-related parameter, a single Liar's Dice decision consumed 3,072 output tokens—**all reasoning, with no visible answer at all**.
- **The OpenAI-style fix did nothing.** I sent `max_completion_tokens: 3072`. The API returned HTTP 200, then generated **15,809 tokens over 222 seconds**. It did not reject the parameter; it simply behaved as if it had never seen it.
- **Even a made-up parameter was accepted.** `totally_bogus_param: true` also returned HTTP 200. **Unknown parameters are silently swallowed**, so you cannot tell whether a limit took effect until the bill arrives.
- **The same task took 2 seconds and 95 tokens with reasoning disabled.** With reasoning enabled, it took 65 seconds and 4,500 tokens, while the visible answers were almost the same length.
- **Cost per usable answer:** ¥0.0105 with reasoning off; **¥0.175—16.7× more—with reasoning on and an 8,192-token budget**. With a 3,072-token budget, the effective cost was infinite: zero usable answers out of three, but every call was still billed.
- **Did quality improve?** Against the older quantized build on OpenRouter, I found **no detectable improvement** on a hard metric with almost no room for interpretation (1/71 vs. 2/22; not statistically significant, with a small sample).
- **Reasoning can be disabled.** `reasoning_effort: "none"` and `thinking: {type: "disabled"}` worked. `enable_thinking: false` did not—and the API never told me.

## Why I Tested This

I am building a single-player Liar's Dice game called **Kai!** The opponent is not a scripted bot; it is powered by a large language model. It uses the same game engine as the player, sees the same information, reveals its thoughts before a challenge, and remembers how you played across rounds. Swap the model, and you effectively get a different opponent.

That means I need to know how much each decision costs and how long it takes. **This was not benchmark curiosity. It was a practical problem forced on me by latency and billing.**

Then I hit a wall.

## The First Wall: I Paid for Three Empty Strings

The prompt for one Liar's Dice decision is about 3,200 Chinese characters. With `max_tokens: 3072`, three consecutive calls failed:

```text
finish=length  completion=3071  reasoning=3071  visible=0 chars  50s
finish=length  completion=3072  reasoning=3072  visible=0 chars  47s
finish=length  completion=3072  reasoning=3072  visible=0 chars  42s
=> usable: 0/3
```

**Every one of those 3,000-plus output tokens went into reasoning. Not a single character of the visible answer made it out.** Billing is based on generated tokens, so I paid in full for all three calls and received three empty strings.

Worse, the application interpreted the result like this: no parseable action → fallback marks the move as noncompliant → the dashboard displays **“this model disobeyed instructions in 94.4% of hands.”** That figure came from my project's August 13 batch, not this isolated test. **I nearly recorded a real token-budget failure as a model-behavior failure.**

## So How Much Budget Does It Need?

I ran the same task three times under four configurations:

| Configuration | Usable | Completion tokens | Reasoning | Visible answer | Latency |
|---|---:|---:|---:|---:|---:|
| Reasoning on · `max_tokens`=3072 | **0/3** | 3071–3072 | 100% | **0 chars** | 42–50s |
| Reasoning on · 8192 | **1/3** | 7837–8192 | ~95% | 0 / 118 chars | 121–126s |
| Reasoning on · 32768 | 3/3 | 3220–5785 | ~97% | 117–140 chars | 49–82s |
| **Reasoning off** · 3072 | **3/3** | **84–107** | — | 123–156 chars | **2–4s** |

Three things were true at the same time.

**1. The tighter the budget, the more likely the model was to consume all of it.** A 3,072-token budget ended at 3,072. An 8,192-token budget usually ended near 8,192. Only when I raised the limit to 32,768—far beyond the 3,200–5,800 tokens it normally needed—did it stop naturally and reliably.

**2. Reasoning usage was hard to budget.** On the same task, reasoning ranged from **3,137 to 5,691 tokens**. With the intended limit ignored, it climbed to **15,774**. This is not merely “thinking more.” It makes per-call budgeting unreliable: when usage can nearly double—or go much higher—which number are you supposed to provision for?

**3. The longer reasoning did not produce a longer answer.** With reasoning off, the visible answers were 123–156 Chinese characters. With reasoning on, they were 117–140. **Forty-seven times the tokens and twenty-two times the latency did not produce a longer or more complete answer.**

For my application, there was an even more fundamental problem: **a round has a 30–60 second pacing budget**, while one reasoning-enabled decision took 49–222 seconds. At that point, this was no longer just an issue of price. The product experience stopped working.

## Is the Protocol at Fault, or Is DeepSeek?

Before publishing, I tested the parameter behavior separately. The answer is: **both contributed, but not equally.**

On the protocol side, the OpenAI-compatible `max_tokens` field places reasoning and visible output in the same budget. If reasoning consumes the allowance, the answer has nothing left. OpenAI's own reasoning models have had the same trap, which is why `max_completion_tokens` was introduced and why the documentation warns that a budget that is too small can produce an empty response. **That part is a protocol-design problem.**

Then I tested the relevant parameters against DeepSeek's endpoint:

| Parameter sent | Intended behavior | **Actual behavior** |
|---|---|---|
| Nothing | — | **Reasoning on by default**; budget exhausted |
| `max_completion_tokens: 3072` | OpenAI-style completion limit | **Silently ignored:** 15,809 tokens, 222 seconds |
| `reasoning: {max_tokens: 1024}` | OpenRouter-style reasoning limit | **Silently ignored** |
| `reasoning_effort: "none"` | Disable reasoning | ✅ Worked (18 tokens, 1 second) |
| `thinking: {type: "disabled"}` | Disable reasoning | ✅ Worked (18 tokens, 1 second) |
| `enable_thinking: false` | Disable reasoning | **Silently ignored** |
| `chat_template_kwargs: {...}` | Disable reasoning | **Silently ignored** |
| `totally_bogus_param: true` (invented) | Reject the request | **HTTP 200; silently swallowed** |

The final row is the root of the problem. **The API silently accepts unknown parameters.** Every ignored setting therefore looks exactly like a successful setting. You send a limit, receive a 200, and assume the call is capped—**until the bill tells you otherwise.**

`max_completion_tokens` is the clearest example. It exists specifically for reasoning models and for exactly the budgeting failure described here. DeepSeek accepted it, returned HTTP 200, and then let the model generate 15,809 tokens. **Unsupported parameters can be rejected. Silently ignoring them is the worst possible behavior.**

My conclusion: **the protocol dug the hole; DeepSeek made it deeper and removed the ladder.**

## But Is the Production Release at Least Better?

This is where I most wanted the data to give DeepSeek some credit. It did not.

First, price needs careful wording. The older `deepseek-v4-pro` build on OpenRouter was listed at $1.17/$2.34 per million input/output tokens. The production `-0813` release was listed at $0.43/$0.87, while DeepSeek's official endpoint charged ¥3/¥6—roughly $0.42/$0.85. **On paper, the production release was about two-thirds cheaper.** But OpenRouter had already priced the older deployment relatively high, and I cannot separate channel markup from an actual model price cut. So I cannot honestly claim that “the production release became more expensive.”

What did increase was the **cost per usable answer**. With reasoning off, one hand cost ¥0.0105. With reasoning on and an 8,192-token budget, only one of three calls produced a usable answer. Including the two wasted calls, the cost became **¥0.175 per usable answer—16.7 times higher**. At 3,072 tokens, the effective cost was infinite: none of the calls could be used, but all were billed. Whatever happens to list price, this multiplier consumes the savings.

For quality, I chose a hard metric with almost no strategic ambiguity: when the current bid is already guaranteed to be true using only the model's own dice, the model still chooses to challenge. **That challenge is guaranteed to lose.**

| Version | Relevant hands | Bad challenges | Rate |
|---|---:|---:|---:|
| Older build (OpenRouter, quantized) | 71 | 1 | **1%** |
| Production 0813 (official endpoint) | 22 | 2 | **9%** |

**z=1.22; the difference was not statistically significant.** The rigorous conclusion is not that the production release was worse. It is that **I could not detect any improvement on this metric; if there was a directional signal, it pointed the other way.**

This result needs an important caveat: the two versions were **never tested head-to-head in the same batch**. The comparison includes different opponents, random seeds, and prompt revisions. The production release also had only 22 relevant situations. **The data can challenge a claim of obvious improvement, but it cannot prove regression.**

## Conclusion

I am not saying DeepSeek is bad. With reasoning disabled, V4-Pro returned a clean decision in two seconds for roughly one cent per hand, and it performed well at my table. **My hosted seat still runs on DeepSeek.**

The real problem is the combination of three product decisions:

1. **Reasoning is enabled by default.** For a per-call application, that can be a pure cost rather than a benefit.
2. **There is no working reasoning-budget limit.** Both the OpenAI-style and OpenRouter-style settings were ignored.
3. **Unknown parameters are silently swallowed.** This makes the first two problems hard to diagnose.

The third decision is the one that most needs to change. **An API that returns an error can be debugged in ten minutes. An API that silently returns 200 forces users to work backward from a bill and a misleading “94.4% noncompliant” dashboard to discover what actually happened.**

If you call this model programmatically, explicitly send **`reasoning_effort: "none"`** or **`thinking: {type: "disabled"}`** when you do not need reasoning. Do not rely on `enable_thinking: false`: in my test it had no effect, and the API did not say so.

---

*Kai! is a single-player Liar's Dice game. Your opponent calculates probabilities, remembers your habits, and reveals its thoughts before a challenge. Every number in this article came from the model-selection work behind the game.*
