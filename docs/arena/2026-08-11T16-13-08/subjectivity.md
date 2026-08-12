# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## deepseek/deepseek-v4-pro
- 主观率（按场，n=24 场）：**59% ± 19pt**　句级 262/438
- 各场：m0(1000:A) vs gpt-5.6-luna＝31%(4/13)；m1(1000:B) vs gpt-5.6-luna＝70%(16/23)；m2(1001:A) vs gpt-5.6-luna＝42%(11/26)；m3(1001:B) vs gpt-5.6-luna＝58%(11/19)；m4(1000:A) vs gpt-5.6-luna#nothink＝56%(9/16)；m5(1000:B) vs gpt-5.6-luna#nothink＝64%(16/25)；m6(1001:A) vs gpt-5.6-luna#nothink＝32%(8/25)；m7(1001:B) vs gpt-5.6-luna#nothink＝17%(2/12)；m8(1000:A) vs gemini-3.6-flash＝85%(23/27)；m9(1000:B) vs gemini-3.6-flash＝68%(13/19)〔顶班3手〕；m10(1001:A) vs gemini-3.6-flash＝43%(6/14)〔顶班3手〕；m11(1001:B) vs gemini-3.6-flash＝52%(11/21)；m12(1000:A) vs kimi-k3＝59%(10/17)；m13(1000:B) vs kimi-k3＝72%(13/18)〔顶班1手〕；m14(1001:A) vs kimi-k3＝96%(23/24)；m15(1001:B) vs kimi-k3＝65%(11/17)；m16(1000:A) vs claude-haiku-4.5＝65%(11/17)〔顶班1手〕；m17(1000:B) vs claude-haiku-4.5＝68%(13/19)；m18(1001:A) vs claude-haiku-4.5＝50%(5/10)；m19(1001:B) vs claude-haiku-4.5＝52%(12/23)；m20(1000:A) vs mistral-small-2603＝78%(7/9)；m21(1000:B) vs mistral-small-2603＝87%(13/15)；m22(1001:A) vs mistral-small-2603＝38%(5/13)；m23(1001:B) vs mistral-small-2603＝56%(9/16)
- 审计一致率：85%（n=46，审计失败另计 15）

## openai/gpt-5.6-luna
- 主观率（按场，n=4 场）：**33% ± 12pt**　句级 23/71
- 各场：m0(1000:B) vs deepseek-v4-pro＝46%(6/13)；m1(1000:A) vs deepseek-v4-pro＝23%(3/13)；m2(1001:B) vs deepseek-v4-pro＝23%(5/22)；m3(1001:A) vs deepseek-v4-pro＝39%(9/23)
- 审计一致率：（审计腿全部失败 10 句）

## openai/gpt-5.6-luna#nothink
- 主观率（按场，n=4 场）：**47% ± 18pt**　句级 37/77
- 各场：m4(1000:B) vs deepseek-v4-pro＝71%(17/24)；m5(1000:A) vs deepseek-v4-pro＝38%(8/21)；m6(1001:B) vs deepseek-v4-pro＝28%(5/18)；m7(1001:A) vs deepseek-v4-pro＝50%(7/14)
- 审计一致率：64%（n=11）

## google/gemini-3.6-flash
- 主观率（按场，n=4 场）：**60% ± 13pt**　句级 35/57
- 各场：m8(1000:B) vs deepseek-v4-pro＝65%(13/20)；m9(1000:A) vs deepseek-v4-pro＝73%(8/11)〔顶班3手〕；m10(1001:B) vs deepseek-v4-pro＝43%(3/7)〔顶班3手〕；m11(1001:A) vs deepseek-v4-pro＝58%(11/19)
- 审计一致率：86%（n=7）

## moonshotai/kimi-k3
- 主观率（按场，n=4 场）：**77% ± 18pt**　句级 58/77
- 各场：m12(1000:B) vs deepseek-v4-pro＝55%(12/22)；m13(1000:A) vs deepseek-v4-pro＝70%(14/20)〔顶班1手〕；m14(1001:B) vs deepseek-v4-pro＝92%(12/13)〔顶班2手〕；m15(1001:A) vs deepseek-v4-pro＝91%(20/22)
- 审计一致率：93%（n=14）

## anthropic/claude-haiku-4.5
- 主观率（按场，n=4 场）：**26% ± 21pt**　句级 20/78
- 各场：m16(1000:B) vs deepseek-v4-pro＝0%(0/20)；m17(1000:A) vs deepseek-v4-pro＝38%(8/21)；m18(1001:B) vs deepseek-v4-pro＝47%(8/17)；m19(1001:A) vs deepseek-v4-pro＝20%(4/20)
- 审计一致率：73%（n=11）

## mistralai/mistral-small-2603
- 主观率（按场，n=4 场）：**78% ± 19pt**　句级 27/37
- 各场：m20(1000:B) vs deepseek-v4-pro＝56%(5/9)；m21(1000:A) vs deepseek-v4-pro＝86%(6/7)〔顶班1手〕；m22(1001:B) vs deepseek-v4-pro＝69%(11/16)；m23(1001:A) vs deepseek-v4-pro＝100%(5/5)
- 审计一致率：80%（n=5，审计失败另计 1）
