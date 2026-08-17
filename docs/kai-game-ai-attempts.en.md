# I Built an AI Liar's Dice Opponent That Remembers How You Play

> This is a development note. The project and test data are real; AI helped me clean up the prose. Cross-match memory and player-authored rules are still experimental, and the match below is a single example rather than evidence of a stable model personality.

I've been working on a small game called [Kai!](https://kai-dice.pages.dev). It is Liar's Dice with a language model sitting across the table. Each player sees only their own dice, then takes turns claiming that the table contains at least a certain number of one face. The next player raises the bid or calls the bluff.

The rules are simple. Most of the work ended up outside the rules: deciding what the model should remember, whether the player can exploit those memories, and what happens after the base game becomes familiar.

I created the repository on August 7. At first I only wanted to see whether an LLM could play a complete game of Liar's Dice. A few days later, most of my time was going into deleting features and changing interfaces. These are the parts that turned out to be interesting.

## One match log that caught my attention

Here is a sample from a self-play run. DeepSeek V4-Pro had these dice:

```text
3  6  5  6
```

It had two sixes and no wild one. On its turn it looked at the dice, used the probability action, and bid five sixes:

> “The probability looks good. Five sixes.”

The private reasoning stored alongside that move said something more interesting. Its opponent believed it was generally truthful and liked to calculate before bidding. Repeating the familiar look-then-calculate routine could make the aggressive bid seem more credible. DeepSeek was also ahead on chips and decided it could afford to be caught.

That was the first log that made the memory system feel like part of the game. The model was considering the dice, but it was also using its opponent's impression of it. It had played in a recognizable rhythm, accumulated some credibility, and was now spending that credibility on a risky bid.

I never put a “build trust, then bluff” strategy in the prompt. The idea came from the cross-match profile.

This is still one sample. A different seed could easily produce a completely different line. The useful result is narrower: a judgment created in one match can make its way into a later decision.

## The first opponent was mostly a character prompt

The original opponent was called Old Li. He was the owner of the dice table: proud, vindictive, and very particular about how he spoke. I put his flaws, strategic preferences, and voice directly into the prompt. It worked immediately. The first playable version already felt like it had a character.

A few days later I deleted him.

The problem was straightforward. I could swap the underlying model and the player would still meet Old Li. The model was performing a character I had written, which made it difficult to see whether different models produced meaningfully different opponents. That was going to get in the way of the AI Arena I wanted to build later.

Every model now receives the same system prompt. It does not even know the display name shown in the interface. There are obvious drawbacks: some models barely talk, while others play well and say boring things. The dramatic quality is less predictable. At least the differences between the models have room to show up.

Removing the character prompt created another problem. Why should the player feel that the opponent in the next match is the same opponent? I eventually moved that responsibility into the profile system.

## The profile contains two kinds of information

After a match, the game keeps two kinds of records.

The first kind is recomputed by the deterministic engine: how often the player bluffed, when they called, how accurate those calls were, and which rounds cost them a die. The model does not get to rewrite those facts.

The second kind contains the model's own opinions: this player backs down when the multiplier is high; they like to calculate before bidding; that pause looked like weakness. Those opinions are allowed to be wrong. In practice, the mistakes may be the more interesting part because the profile is visible to the player.

If the model decides that you are honest, you can use that belief to cover a bluff in the next match. If it thinks you fold under pressure, you can deliberately hold your ground. The model then reads the new behavior and updates the profile again. It observes you, while you manage the version of you that exists in its notes.

The five-sixes example came from that loop. DeepSeek knew its opponent expected truthful, calculation-heavy play, so it kept the calculation routine and followed it with a dangerous bid.

I still have too few outside players to know whether anyone will actually play extra matches in order to manipulate a profile. Self-testing cannot answer that question.

## I eventually removed the probability tool

Liar's Dice involves a fair amount of probability estimation. An early version gave both the human and the AI an exact calculator. The two sides had identical access, which seemed fair.

It made the game boring very quickly. Players started following the number: call when the probability was low, raise when it was high. Earlier behavior, chip pressure, and the image each player had built stopped mattering much.

I first changed the calculator into a public once-per-round action so that the timing of a calculation could become a signal. Later tests exposed another issue. Some models had already calculated the probability correctly before using the tool, so the action added little beyond an animation. Other models relied on the number and stopped paying attention to the opponent.

The calculator is no longer on the normal table. Accurate estimation is an advantage. A mistake also reveals how that opponent understands risk. I added the tool to give players another capability and ended up getting more decisions after removing it.

## Letting players describe a new table rule

The base game will eventually become familiar, so I built an experimental table for user-created rules.

The first version was a menu-based workshop. Players combined a trigger, a cost, and an effect. It was easy to implement and felt like filling out a configuration form.

The current version is a “wish desk.” A player can write a sentence such as:

> Once per match, after looking at my dice, I can double the pot and reveal one of my dice.

The model translates that sentence into a restricted rule AST. The engine renders the AST back into a plain-language rule card so the player can check what the machine understood. If the card looks right, random bots play 200 games with it. The test looks for deadlocks, accounting errors, and rules whose actions never actually become available.

Only after those checks does the rule appear on the experimental table.

I do not let the model referee the match. It performs one translation before play begins. During the game, the engine executes the AST deterministically, and every action enters the event log and replay.

The available rule primitives are deliberately limited. A rule can reveal one of the player's own dice, return a bid to the bidder, claim that the current bid is exactly correct, or increase the pot multiplier. Requests to reroll dice or peek at an opponent's hand are rejected because the engine does not implement those capabilities yet.

Failed wishes are stored locally. I plan to use them as a product backlog. If many players keep asking for rerolls, that is a better signal for the next rule primitive than me guessing in isolation.

Official rules and player-authored rules use the same AST. Once a rule passes validation, the engine treats them the same way. Experimental games stay out of the normal rankings, ledger, and behavioral profiles so a strange custom rule cannot contaminate ordinary match data.

## What I still do not know

The main paths work in code: the AI can carry opinions about a player across matches; the player can inspect those opinions; and a natural-language rule can be compiled, tested, and placed on the experimental table.

The remaining questions need real players. Will people exploit a model's mistaken impression? Will they deliberately act for several matches to shape a profile? Will the wish desk produce new games, or will it be something everyone tries once and forgets?

If this sounds interesting, you can [play Kai! here](https://kai-dice.pages.dev). The most useful feedback for me is either a strange profile the model wrote about you or a table rule you wish the game supported. Failed wishes are useful too; they may tell me more than the successful ones.

And if the AI decides that you are honest, do not clear the profile immediately. Try using that reputation in the next match.
