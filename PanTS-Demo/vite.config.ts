import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';


// https://vite.dev/config/

const env = loadEnv('development', process.cwd(), '');

export default defineConfig({
	plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
	resolve: {
		extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.wasm'], // add .wasm
	},
	optimizeDeps: {
		// @cornerstonejs/dicom-image-loader ships its pixel-decode WORKERS as separate
		// entry files (decodeImageFrameWorker.js?worker_file). If the dep optimizer
		// pre-bundles the loader it mangles those worker references ("file does not
		// exist … in the optimize deps directory"), the decode worker never runs, and
		// every DICOM slice decodes to zeros → black viewport. Exclude the loader so
		// its workers are served from source and Vite's worker pipeline handles them.
		exclude: ["@cornerstonejs/dicom-image-loader"],
		// With the loader excluded, its decode worker imports the codecs from source.
		// The worker STATICALLY imports every codec at load time, so if any one fails
		// the whole worker dies (no slice decodes). Those codecs are CommonJS emscripten
		// glue (`module.exports = …`); served raw they "provide no default export".
		// Pre-bundling each gives it the CJS→ESM default-export interop. Plus the bare
		// `import('jpeg-lossless-decoder-js')` for JPEG-Lossless (TS .4.70) scans.
		// dicom-parser is UMD/CJS: served raw its UMD footer runs `root["zlib"]` with
		// `root = this` = undefined at ESM top level → "Cannot read properties of
		// undefined (reading 'zlib')". This exclude+include pair matches the official
		// Cornerstone3D Vite guidance. (comlink is real ESM, chai is test-only — safe.)
		include: [
			"dicom-parser",
			"jpeg-lossless-decoder-js",
			"@cornerstonejs/codec-charls/decodewasmjs",
			"@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs",
			"@cornerstonejs/codec-openjpeg/decodewasmjs",
			"@cornerstonejs/codec-openjph/wasmjs",
		],
	},
	build: {
		target: "esnext",
	},
	// The DICOM image loader's decode workers use dynamic imports; the default
	// "iife" worker format can't code-split, so build workers as ES modules.
	worker: {
		format: "es",
	},
	assetsInclude: ['**/*.wasm'],
	server: {
		// https: {
		// 	key: fs.readFileSync(path.resolve(__dirname, '../certs/localhost-key.pem')),
		// 	cert: fs.readFileSync(path.resolve(__dirname, '../certs/localhost-cert.pem')),
		// },
		// headers: {
		// 	'Cross-Origin-Opener-Policy': 'same-origin',
		// 	'Cross-Origin-Embedder-Policy': 'require-corp',
		// },
		cors: true,
		proxy: {
			"/api": {
				target: env.VITE_API_BASE,
				changeOrigin: true,
				secure: false,
			},
		},
	},
});
