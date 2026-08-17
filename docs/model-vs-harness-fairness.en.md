# Are You Benchmarking the Model—or the Harness?

### I nearly turned four software bugs into four model personalities

> This article was edited with AI assistance. The cases and data come from real batch runs in the *Kai!* AI Arena. Every claim is limited to the game rules, model versions, and experimental setup used at the time. This is not a general model ranking.

---

If I had published one day earlier, DeepSeek V4-Pro might have acquired a personality trait it never had: **bidding without looking at its dice.**

First, a quick explanation of the table. In Liar's Dice, each player has a set of hidden dice. Players take turns claiming that the whole table contains at least *N* dice of a particular face. The next player must either raise the bid or challenge it. Everyone then reveals their dice: if the bid holds, the bidder wins; if it does not, the challenger wins. In *Kai!*, looking at your own dice is an explicit action, so a player may bid before looking. I call that a blind bid.

The evidence looked solid. In the first batch of AI matches, DeepSeek V4-Pro made nearly 40% of its bids before looking at its dice.

A story almost wrote itself. Perhaps it trusted intuition. Perhaps it was unusually willing to gamble or liked to seize the initiative. Another model usually looked first and calculated before bidding. Put the win rate, dialogue, and action logs side by side, and two distinct “personalities” seemed to emerge.

Then I inspected the context.

Even when the model had not used the probability tool, the system was still inserting a rough probability estimate into its prompt. The candidate actions were also sorted by probability. The model appeared to be bidding under the cup, but the harness was feeding it a strong hint from offstage.

After I fixed the leak, V4-Pro's blind-bid rate fell from roughly **40% to 6%**.

What looked like a model insight had been an explanation of a software bug. A compelling conclusion vanished from the data.

Then I found three more bugs of the same kind. Across the first roughly 60 matches, more than half of the most visible differences between models shrank after the fixes.

That changed how I think about model evaluation:

**An arena directly measures a system made of a model and a harness. Before attributing the result to the model, you must show that the measurement system did not quietly think for it, hide part of its input, or rewrite its failures.**

By *harness*, I mean everything wrapped around the model: prompts, context assembly, tools, action spaces, token budgets, provider routing, output parsing, retries, and fallbacks. The model produces an answer. The harness decides what it sees, what it is allowed to do, and which part of that answer survives into the database.

## The “personality” that fell from 40% to 6%

At first I thought I had found one implementation mistake. I kept looking and found a second, a third, and a fourth. The troubling part was that none of them stopped the matches. Every game still produced actions, dialogue, and a final score. The dataset looked complete.

| Harness problem | The apparent model trait | What changed after the fix |
|---|---|---|
| `max_tokens=400` truncated long outputs | Poor formatting; often replaced by a fallback bot | Format failures and fallbacks dropped sharply |
| Rough probabilities were included without a tool call, and actions were sorted by probability | Liked to bid without looking | Blind-bid rate fell from about 40% to 6% |
| Opponent dialogue was not forwarded | Weak player with little social reasoning | Win rate returned to roughly 40–60% |
| Subjective judgments were stored only up to the first 100 characters | Rambling reasoning and incoherent records | The original chain of reasoning reappeared when full text was saved |

The four bugs interfered at four different points.

The probability leak changed the input. Missing dialogue removed information the model should have had. The token cap truncated its output. The database then changed the evidence I used to interpret that output. The harness shaped both the move and my explanation of the move.

These distortions are especially dangerous because each one generates a plausible story. A truncated answer becomes weak instruction following. Missing dialogue becomes poor social reasoning. An action list that has already ranked the safe moves becomes decision-making ability. As long as the system still produces a score, it is easy to skip the measurement process and attach a label to the model.

The uncomfortable conclusion is that the evaluation framework is also playing.

So when I see a model leaderboard now, I do not begin with who won. I begin with a different question: **What task did each model actually receive?**

## How can the same prompt become two different tasks?

Model arenas often point to a shared prompt as evidence of fairness. It is necessary, but it controls only one part of the experiment.

In the early version of *Kai!*, both seats received the exact same system prompt. Any of the following could still change the task:

- the order of candidate actions;
- whether the system supplied information the model had not requested;
- whether the opponent's dialogue reached the context intact;
- whether reasoning tokens and the final answer shared one budget;
- whether a truncated answer counted as a failure, triggered a retry, or handed control to a bot;
- which provider or quantized backend a model ID actually reached;
- whether the parser saved the raw answer or only an excerpt.

A prompt is a string sent to a model. The task also includes its information boundary, tool permissions, compute budget, and failure policy.

This is why apparently uniform settings can create systematic bias. A concise model may escape truncation while a long-reasoning model spends its entire budget before producing a final answer. A model sensitive to option order will react to the placement of candidate actions. A model that relies heavily on conversational cues will lose more when dialogue is omitted.

Does a more uniform setup always make an experiment fairer? That depends on what you are trying to measure.

## “Fair” is not a single configuration

Many arguments about benchmark fairness are really arguments about different questions.

If I already have a fixed product interface and want to know which model can replace another with the least work, I should hold the prompt, tools, budget, and parser constant. That measures compatibility with a shared product contract.

If I want to measure the ceiling of each model, I should optimize the prompt, tools, and reasoning settings separately. The result now includes adaptation work, so it no longer represents models running under identical conditions.

If I care about return on resources, I should fix cost, latency, or token use. That experiment measures output under the same constraint, not absolute capability.

All three protocols are valid:

| Protocol | What is controlled | What it can answer |
|---|---|---|
| Interface fairness | Same prompt, tools, budget, and action space | Which model fits the same product contract best? |
| Capability ceiling | Model-specific prompt, tool, and reasoning optimization | What can each model do after adaptation? |
| Resource fairness | Same cost, latency, or token budget | Which model produces more under the same constraint? |

Problems begin when the claim outruns the protocol. A shared-prompt benchmark can tell us which model works better with that prompt. It cannot directly establish each model's capability ceiling. Individually tuned results may show a ceiling, but the evaluator's tuning skill has entered the experiment.

Every benchmark report should state its fairness constraint first, then limit its claims accordingly.

The current “bare table” track in *Kai!* uses interface fairness. It answers a product question: if I swap the model behind the same game interface, what kind of opponent does the player get?

Once that protocol is chosen, the difficult work begins: keeping the harness from appearing in the score as model ability.

## Keeping the harness out of the score

I turned that goal into a set of concrete constraints.

First, every model acts through the same player interface. It can see only its own dice and public events, and every action is checked by the same deterministic engine. The information boundary lives in the schema rather than in a promise written into the prompt.

Second, the same dice seed is played twice with the seats swapped. This reduces the effect of first move, seat position, and random rolls. A single win never becomes a model-level conclusion.

Third, I freeze more than the prompt. Candidate order, context serialization, tool responses, sampling parameters, parsers, and code versions are all experimental conditions. Each batch stores a prompt hash and Git commit. If one of them changes, I start a new batch.

Fourth, I record what the provider actually did. Sending `max_tokens` or a reasoning flag does not prove that the server honored it. Each call records completion tokens, reasoning tokens, finish reason, latency, cost, and actual route. Empty responses and timeouts remain in the dataset.

Finally, retries, repairs, and bot takeovers appear beside the score. A production system needs fallbacks, but an evaluation cannot let a fallback quietly impersonate model behavior. The leaderboard reports formatting failures, refusals, and fallback rates, with a separate view for zero-fallback samples.

These rules sound like engineering hygiene, but they decide whether the conclusion holds. A reliable product harness hides failures so the player can continue. A credible evaluation harness exposes them. The two can share code; they cannot share an unmarked data definition.

Even after all this, a leaderboard has boundaries. Controlling variables can make an answer more reliable. It cannot make the experiment answer a question it never asked.

## How far can one leaderboard reach?

I divide the *Kai!* metrics into three layers:

- **Compliance:** illegal actions, format failures, refusals, and fallback takeovers. Can the model fulfill the current interface contract?
- **Playing strength:** win rate, successful challenges, and net chips. How good are its decisions under these rules and information conditions?
- **Behavioral texture:** bluff rate, blind bids, raise depth, dialogue, and response rhythm. Does swapping the model create a perceptibly different opponent?

Each layer is useful, but its interpretation is limited. A low format-failure rate may come from better instruction following or a more forgiving parser. A high win rate shows strength at this game; it does not automatically become a general reasoning score. Behavioral differences matter to the product experience, but with thin samples they are observations, not permanent personalities.

The current clean set contains seven model IDs, 11 pairings, 22 seat arms, and 44 matches. That is enough to expose obvious harness failures. It is nowhere near enough for a general model ranking. The memory track also introduces cross-match path dependence, so it is stored separately from the memory-free bare-table track.

There is only one narrow claim I am willing to make from this dataset:

**Under the recorded versions, routes, budgets, rules, and samples, different models behaved differently as opponents in *Kai!*.**

One step beyond that requires another experiment.

## Every model claim needs a counterfactual

The original story—“DeepSeek likes to bid without looking”—was easy to write. It had numbers, contrast, and the appeal of model personality. It was also false.

The rate moved from 40% to 6% without a model upgrade or prompt optimization. I merely removed information the harness had been leaking.

This is the part of model evaluation that leaderboards tend to hide. The model stands under the spotlight while the measurement tool disappears into the dark. Yet the tool still organizes the input, allocates the budget, handles errors, and decides which answer becomes evidence.

A perfectly neutral harness may be impossible. The design of the action space, the budget, and the metric set all involve choices. We can at least make those choices visible: pin versions, retain raw calls, publish failure rates, separate fallback samples, and state where the conclusion stops.

Now, whenever I am about to write “this model is bolder” or “that model cannot read people,” I ask one counterfactual question:

**If I changed only the harness, would the difference survive?**

Without that check, a model trait is only an observation waiting to be debugged.

So the next time a model looks brave, cautious, clever, or foolish, resist the personality analysis for a moment.

Check the table first.
