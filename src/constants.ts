/** 开灯后的环境光强度（各关一致；关灯值由关卡配置 darkAmbient 决定） */
export const LIT_AMBIENT = 0.8
/**
 * 开灯后的雾起始距离（near）：此距离以内完全清澈无雾。
 * 取 120 > 全图最长直视距离（100×100 地图对角 ≈141 中实际可视走廊/房间对角 ≈113），
 * 开灯后任何房间都能一眼看到底；120~200 之间才轻微渐暗保留景深氛围。
 */
export const LIT_FOG_NEAR = 120
/** 开灯后的雾完全不透明距离（far；关灯值由关卡配置 darkFogFar 决定） */
export const LIT_FOG_FAR = 200
/** 关灯时的雾起始距离：贴脸即起雾，营造摸黑压迫感（远平面 = darkFogFar） */
export const DARK_FOG_NEAR = 2
