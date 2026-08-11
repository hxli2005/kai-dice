# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## moonshotai/kimi-k3
- 主观率（按场，n=4 场）：**82% ± 20pt**　句级 68/82
- 各场：1000:A:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝88%(15/17)；1000:B:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝87%(20/23)；1001:A:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝53%(10/19)；1001:B:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝100%(23/23)
- 审计一致率：69%（n=13）

## openai/gpt-5.6-luna#nothink
- 主观率（按场，n=4 场）：**78% ± 19pt**　句级 62/79
- 各场：1000:B:kimi-k3 vs kimi-k3＝83%(20/24)；1000:A:kimi-k3 vs kimi-k3＝77%(17/22)；1001:B:kimi-k3 vs kimi-k3＝100%(16/16)；1001:A:kimi-k3 vs kimi-k3＝53%(9/17)
- 审计一致率：64%（n=11）
