import { defineConfig } from 'vite';

export default defineConfig({
  // host: true 表示监听所有网卡，局域网内其它设备可以直接访问
  server: { host: true, port: 5173, open: true },
  // 预览服务器跑的是 build 产物，用来把沙盒发给同事试玩
  preview: { host: true, port: 8080, strictPort: true },
  build: { target: 'es2022' },
  // @pb/sim 直接以 TS 源码形式被引用，跳过依赖预打包，改动可即时热更新
  optimizeDeps: { exclude: ['@pb/sim'] },
});
