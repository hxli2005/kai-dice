# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## moonshotai/kimi-k3
- 主观率（按场，n=4 场）：**87% ± 14pt**　句级 72/82
- 各场：m0(1000:A) vs gpt-5.6-luna#nothink＝94%(16/17)；m1(1000:B) vs gpt-5.6-luna#nothink＝87%(20/23)；m2(1001:A) vs gpt-5.6-luna#nothink＝68%(13/19)；m3(1001:B) vs gpt-5.6-luna#nothink＝100%(23/23)〔顶班1手〕
- 审计一致率：67%（n=12）

## openai/gpt-5.6-luna#nothink
- 主观率（按场，n=4 场）：**19% ± 24pt**　句级 17/79
- 各场：m0(1000:B) vs kimi-k3＝25%(6/24)；m1(1000:A) vs kimi-k3＝50%(11/22)；m2(1001:B) vs kimi-k3＝0%(0/16)；m3(1001:A) vs kimi-k3＝0%(0/17)
- 审计一致率：91%（n=11）
