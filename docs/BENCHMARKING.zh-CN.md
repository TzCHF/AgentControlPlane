# 基准测试

> [English](BENCHMARKING.md)

AgentControlPlane 针对同一项工程任务对比两条执行路径。

## 路径

`direct` 将原始请求发送给 `executor`。

`controlled` 记录 `controller` 用量，向 `executor` 发送一份精简的工程简报，并单独记录 `executor` 用量。

## 必需的控制变量

每对运行使用相同的：

- 仓库提交；
- 干净的工作区状态；
- `executor` 与模型；
- 推理努力度；
- 沙箱与网络策略；
- 验收标准；
- 时间与 token 上限。

每对运行至少执行三次。报告中位数和完整的原始数据。

## 指标

- `controller` 的输入、缓存输入、输出与推理 token；
- `executor` 的输入、缓存输入、输出与推理 token；
- token 总数；
- 耗时；
- 验收结果；
- 测试结果；
- 人工修正；
- 变更的文件；
- 工具调用。

`executor` 节省量衡量 `executor` token 的变化。总节省量包含 `controller` 与 `executor` 的 token。有参考价值的结果还会报告完成率，因为低 token 的失败运行不能满足任务。

## 报告命令

```powershell
npm.cmd run benchmark:report -- benchmark/example-results.json
```

该命令读取一个数组，或一个包含 `cases` 数组的对象，并向标准输出打印一份 JSON 报告。
