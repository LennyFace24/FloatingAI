# Settings Transition Motion 设计规格

日期：2026-07-27
状态：用户已批准

## 目标

设置页进入和返回均使用可中断的原生窗口边界动画；空输入页必须提供可见的设置和收起操作。

## 输入页操作

- prompt 输入条右侧按顺序显示设置、收起、发送。
- 设置使用 Wrench；收起使用 Minus；保留 tooltip 和中文 aria-label。
- 回复页仍在顶栏显示设置和收起；composer 不重复显示这两个按钮。
- 点击收起后播放现有 180ms 收缩动画并恢复悬浮球。
- Escape 仍可收起。

## 设置往返动画

- 打开设置：从当前 prompt/waiting/response 边界动画到夹紧后的设置边界。
- 设置页目标尺寸和工作区约束沿用现有 460×560 与 `settings_bounds`。
- 时长使用 280ms cubic ease-out，与展开助手一致。
- 设置表面事件在动画开始前发布，使动画过程中展示设置内容。
- 动画完成后才设置 Settings mode 和 focus。
- 动画取消或失败时不得发布 Settings mode，也不得执行过期 focus。
- 返回设置：按当前 conversation 派生 phase 调用现有 prompt/waiting/response 动画。
- `prefers-reduced-motion: reduce` 下两个方向均直接提交精确目标边界。

## 验收标准

1. 从空输入页可见并可点击收起按钮，能回到悬浮球。
2. 空输入页可见设置按钮。
3. prompt 进入设置有连续窗口变形动画。
4. waiting/response 进入设置同样有动画。
5. 设置返回 prompt/waiting/response 均有反向动画。
6. 快速切换时旧动画可取消，不覆盖新状态。
7. 设置页打开后仍完整位于当前显示器工作区。
8. 减少动态效果时直接切换，无插值动画。
