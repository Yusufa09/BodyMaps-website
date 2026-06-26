import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./App.css";
import { AnnotationProvider } from "./contexts/annotationContexts";
import { FileProvider } from "./contexts/fileContexts";
import LandingPage from "./pages/LandingPage";
import Homepage from "./routes/Homepage";
import TeamPage from "./routes/TeamPage";

// The viewer routes pull in the WebGL stack (NiiVue + Cornerstone + three.js), which
// is the bulk of the JS bundle. Code-split them so the landing + dataset pages don't
// download the viewer up front — they only load it when a case is actually opened.
const VisualizationPage = lazy(() => import("./routes/VisualizationPage"));
const UploadPage = lazy(() => import("./routes/UploadPage"));
const RotatingHeartLoader = lazy(() => import("./components/Loading"));

const BASENAME = import.meta.env.VITE_BASENAME;

// Lightweight fallback shown while a lazy route chunk loads (intentionally avoids the
// three.js loader so the fallback itself stays out of the main bundle).
function RouteFallback() {
	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "#08090b",
			}}
		>
			<div
				className="animate-spin"
				style={{
					width: 28,
					height: 28,
					borderRadius: "50%",
					border: "2px solid rgba(255,255,255,0.15)",
					borderTopColor: "rgba(255,255,255,0.6)",
				}}
			/>
		</div>
	);
}

function App() {
	return (
		<FileProvider>
			<AnnotationProvider>
				<div className="App">
					<BrowserRouter basename={BASENAME}>
						<Suspense fallback={<RouteFallback />}>
							<Routes>
								<Route path="/" element={<LandingPage />} />
							{/* Old /home.html links now serve the React shell — send them to the app. */}
							<Route path="/home.html" element={<Navigate to="/" replace />} />
								<Route path="/dashboard" element={<Homepage />} />
								{/* <Route path="/data" element={<DataPage />} /> */}
								{/* <Route path="/:type/:page" element={<Homepage />} /> */}
								<Route path="/case/:caseId" element={<VisualizationPage />} />
								<Route path="/session/:sessionId" element={<VisualizationPage />} />
								<Route path="/reconstruction/:reconstructionId" element={<VisualizationPage />} />
								<Route path="/test" element={<RotatingHeartLoader />} />
								<Route path="/upload" element={<UploadPage />} />
									<Route path="/team" element={<TeamPage />} />
							</Routes>
						</Suspense>
					</BrowserRouter>
				</div>
			</AnnotationProvider>
		</FileProvider>
	);
}

export default App;
