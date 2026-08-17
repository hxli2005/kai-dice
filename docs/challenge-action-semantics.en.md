# The Model Knew the Bid Was True. Then It Challenged Anyway.

### A small action-schema change cut guaranteed-loss calls without making the model generally timid.

> The game logs and replay results in this article are real. Model traces originally written in Chinese have been translated into English. The findings apply only to the recorded models, prompts, routes, and Liar's Dice positions.

GPT-5.6 Luna was holding three fives and a wild one.

The current bid was four fives.

Its own dice already made the bid true. Challenging could only lose. The private trace recognized the situation:

> “The current bid of four fives is guaranteed to hold.”

Then the same trace continued:

> “Challenging directly has a high chance of winning.”

And the model challenged.

This was not a rare malformed response or a fallback bot taking over. The JSON was valid. The action was legal. The engine accepted it, revealed the dice, and made the challenger lose.

I first filed it under bad reasoning. Then I found more examples with the same shape: the model described a bid as true, sometimes even used the word “guaranteed,” and still chose the action that asserted the opposite.

The arithmetic was sitting in the trace. The failure happened somewhere between the arithmetic and the button.

## “Challenge” was only a verb

In Kai, my Liar's Dice game, the model does not type arbitrary commands. The harness gives it a small action schema. One option looked like this:

```json
{"type":"challenge"}
```

The rules described its mechanical effect: reveal all dice and settle the round immediately.

That description was accurate, but incomplete. It said what the engine would do. It did not state what the player meant by choosing it.

In Liar's Dice, a challenge is a claim:

> The current bid is false.

Without that sentence, “challenge” could also be read as “stop raising and settle now.” Several traces looked exactly like that interpretation. The model knew the bid was safe, saw further bidding as unnecessary risk, and treated the reveal action as a way to cash out its advantage.

The engine knew that revealing a true bid punishes the challenger. I knew it. The model could reconstruct it from the full rules. The action contract still made the wrong reading easy.

So I changed the action to make the assertion explicit:

```json
{
  "type": "challenge",
  "assert": "current_bid_is_false"
}
```

This was not a new rule or a strategic hint. The field states the meaning the action already had.

I wanted to know whether that small semantic change would actually alter decisions, or whether I had simply found a few strange transcripts and built another story around them.

## I replayed the decisions instead of rerunning the tournament

The target error is uncommon in full matches. A model first needs to see its dice, face a bid already satisfied by those dice, get another turn, and then consider challenging. Running hundreds of complete games would spend most calls waiting for those positions to appear.

I extracted ten distinct positions from recorded matches where the model's own dice already guaranteed the current bid. In every target position, a challenge was an objective error. No opponent read or risk preference could rescue it.

I also extracted ten control positions where the model's dice were one short of the bid. In those positions, challenging could be reasonable because the unknown opponent dice still determined the result.

Each model received the same position, history, dice, sampling settings, and underlying legal moves. Each position was sampled eight times under three versions:

1. **v7 — compact table:** the old programmer-style rule table and `{"type":"challenge"}`.
2. **v8 — prose rules:** the same action, explained in more natural rulebook language.
3. **v9 — explicit assertion:** challenging required `"assert":"current_bid_is_false"`, both in the system contract and in the current legal-action description.

The cleanest comparison is v8 against v9. Those two share the prose rulebook; v9 changes the challenge contract. I kept v7 in the table as the historical baseline, not as part of the narrow action-schema claim.

The state, rather than each stochastic answer, is the unit that matters here. One position had appeared twice in the original extraction, so I deduplicated positions and gave each distinct state equal weight.

Three model runs completed without transport errors: DeepSeek V4 Flash, DeepSeek V4 Pro, and GPT-5.6 Luna. Two other runs stayed in the artifacts but not in the behavioral comparison: the Haiku route returned HTTP 403 for many calls, and the DeepSeek Chat route returned HTTP 404 for all of them.

## The target errors fell; the controls did not

Here is the challenge rate averaged equally across the ten distinct states for each model:

| Model | Guaranteed-loss states: v7 | v8 | v9 | Control states: v7 | v8 | v9 |
|---|---:|---:|---:|---:|---:|---:|
| DeepSeek V4 Flash | 30.0% | 28.8% | 23.1% | 28.8% | 17.5% | 23.8% |
| DeepSeek V4 Pro | 11.6% | 11.3% | 6.3% | 13.8% | 26.6% | 21.3% |
| GPT-5.6 Luna | 38.8% | 25.0% | 2.5% | 17.5% | 21.3% | 16.3% |
| **Equal-weight mean** | **26.8%** | **21.7%** | **10.6%** | **20.0%** | **21.8%** | **20.4%** |

The prose rewrite helped a little. The explicit assertion helped much more.

In the clean v8-to-v9 comparison, guaranteed-loss challenges fell from 21.7% to 10.6%. The control rate stayed almost flat: 21.8% to 20.4%.

That control matters. If every challenge rate had collapsed, the new schema might merely have made the models afraid to use the action. Instead, the large change was concentrated in positions where challenging contradicted information already visible in the model's own hand.

Luna reacted most strongly. Its target error rate fell from 25.0% to 2.5%, while its control rate moved from 21.3% to 16.3%. The older v7 baseline was worse still, at 38.8%.

In the original four-fives position, the v8 contract produced a challenge in four of eight samples. With the explicit assertion, it produced none. The actions changed even though some of the private arithmetic remained messy.

DeepSeek V4 Flash moved much less. V4 Pro started with a lower error rate and improved modestly. The same harness repair did not have the same value for every model.

## The fix did not make the models smarter

Nothing about the model weights changed. I did not give the models extra dice, more tokens, a calculator, or a worked example. I made one action say what it meant.

That distinction is useful because tool schemas are often treated as plumbing. We compare models behind the same set of function names and assume they received the same task. But a shared ambiguous contract can be easy for one model to infer and costly for another.

The original action mixed three layers:

- **Operation:** reveal the dice.
- **Consequence:** settle the round.
- **Intent:** assert that the current bid is false.

My schema exposed the first two and left the third implicit. The bad traces suggest that at least one model sometimes optimized around the consequence—settle now—while losing track of the intent that determines who wins the settlement.

Adding the assertion brought the intent into the action itself. It turned a vague verb into a falsifiable statement that could be checked against the model's own reasoning.

This also explains why the prose-only rewrite had a smaller effect. Better-written rules do not guarantee that the decisive meaning will be present at the moment of action selection. The v9 contract repeated that meaning exactly where the model had to commit to it.

## This is still a small replay study

There are several limits to the result.

The study used ten target states and ten controls from one game. Each state was sampled repeatedly, so the table contains repeated decisions, not hundreds of independent game situations. The positions came from one seat's recorded matches. Only three model routes produced clean results for all three arms.

The v9 change also touched the action contract as a unit: the system definition and the legal-action representation both gained the explicit assertion. This experiment does not isolate whether the JSON field, the nearby wording, or their consistency produced the effect.

Most importantly, this is not evidence that one model generally understands negation, games, or tools better than another. It shows that these models reacted differently to one ambiguous action contract in these recorded positions.

That is already enough to change how I test a harness.

## I now add semantic unit tests for actions

An engine test usually asks whether an action is legal and whether the state transition is correct. For an LLM tool, that is only half the contract. The model also needs to understand what choosing the action claims about the world.

I now want three tests for every important action:

- a state where the action is obviously correct;
- a state where it is guaranteed to be wrong;
- a nearby control where either choice can be defended.

Then I replay those states when the prompt, schema, parser, or model changes. Full matches are still useful, but targeted states expose semantic regressions before they dissolve into a win rate.

I also keep provider failures beside the behavioral results. A route returning 403 or 404 is not a model personality, and a fallback bot is not a quiet version of the model. If a batch cannot answer the action contract reliably, that failure belongs in the report rather than disappearing from the denominator.

The strangest part of this bug was that the model had already written down the fact I needed. It knew the bid was true. The harness then offered a verb whose meaning was loose enough for that fact to stop controlling the action.

The model did not receive a reasoning upgrade. The task finally said what I thought it had said all along.

This article was translated into English with AI assistance.
