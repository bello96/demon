import * as THREE from "three";
import wallUrl from "./static/wall.png";
import floor1Url from "./static/floor.png";
import floor2Url from "./static/floor2.jpg";

/**
 * 全局加载管理器 —— 统一追踪所有图片纹理的加载进度。
 * onProgress / onError 由 game.ts 的 UI 层绑定；onLoad 绑定在这里兑现 texturesLoaded Promise。
 */
export const loadingManager = new THREE.LoadingManager();

let _resolveTexturesLoaded!: () => void;
/** 所有图片纹理加载完成（或超时兜底）后 resolve 的 Promise —— 供 UI 层等待 */
export const texturesLoaded: Promise<void> = new Promise<void>((resolve) => {
  _resolveTexturesLoaded = resolve;
});

loadingManager.onLoad = (): void => {
  _resolveTexturesLoaded();
};
loadingManager.onError = (url: string): void => {
  console.warn("[texture] 加载失败：", url);
};
// 兜底：极端网络 / 混合失败下 onLoad 可能不触发，15 秒后强制放行
setTimeout(() => {
  _resolveTexturesLoaded();
}, 15000);

type TexturePattern = "noise" | "planks" | "cabinet";

export function createPixelTexture(
  color: string,
  noiseIntensity: number = 0.1,
  grid: boolean = false,
  pattern: TexturePattern = "noise",
): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  if (pattern === "noise") {
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * noiseIntensity})`;
      const x = Math.floor(Math.random() * 16) * 4;
      const y = Math.floor(Math.random() * 16) * 4;
      ctx.fillRect(x, y, 4, 4);
    }
  } else if (pattern === "planks") {
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(0, i * 16, 64, 2);
    }
  } else if (pattern === "cabinet") {
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 56, 56);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(48, 32, 4, 8);
  }

  if (grid && pattern !== "cabinet") {
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

function loadImageTexture(url: string): THREE.Texture {
  // 传入 loadingManager 以接入全局进度追踪
  const loader = new THREE.TextureLoader(loadingManager);
  const tex = loader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const materials = {
  stone: new THREE.MeshStandardMaterial({
    map: loadImageTexture(wallUrl),
    roughness: 0.9,
  }),
  planks: new THREE.MeshStandardMaterial({
    map: createPixelTexture("#8f563b", 0.2, true, "planks"),
    roughness: 0.8,
  }),
  floor1: new THREE.MeshStandardMaterial({
    map: loadImageTexture(floor1Url),
    roughness: 0.8,
  }),
  roomWall: new THREE.MeshStandardMaterial({
    map: loadImageTexture(floor2Url),
    roughness: 0.9,
  }),
  obsidian: new THREE.MeshStandardMaterial({
    map: createPixelTexture("#1a0b2e", 0.1, true),
    roughness: 0.2,
  }),
  cabinet: new THREE.MeshStandardMaterial({
    map: createPixelTexture("#5c4033", 0.1, false, "cabinet"),
    roughness: 0.7,
  }),
  glow: new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  // 钥匙 / 雷达 / 鞋子三个道具改用 World.makeItemMaterial 生成带字贴图材质
  //（金 #ffd700 / 绿 #00ff00 / 蓝 #1e90ff），不再需要这里的纯色单例
  door: new THREE.MeshStandardMaterial({
    map: createPixelTexture("#3e2723", 0.2, true, "planks"),
    roughness: 0.9,
  }),
  ceiling: new THREE.MeshStandardMaterial({
    map: createPixelTexture("#4a4a4a", 0.15, true),
    roughness: 0.95,
  }),
};
