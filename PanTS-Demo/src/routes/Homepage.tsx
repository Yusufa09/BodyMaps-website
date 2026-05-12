import { IconArrowsShuffle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import About from "../components/About";
import Header from "../components/Header";
import InferenceUpload from "../components/InferenceUpload";
import Preview from "../components/Preview";
import { API_BASE } from "../helpers/constants";
import type { PreviewType } from "../types";

function generateId(min: number = 1, max: number = 9901) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default function Homepage() {
	const [PREVIEW_IDS, SET_PREVIEW_IDS] = useState<number[]>([]);
	const navigation = useNavigate();

	useEffect(() => {
		const newIds = Array.from({ length: 5 }, () => generateId());
		SET_PREVIEW_IDS(newIds);
	}, []);
	const [previewMetadata, setPreviewMetadata] = useState<{
		[key: string]: PreviewType;
	}>({});

	const [loading, setLoading] = useState(true);

	// const navigate = useNavigate();

	const aboutRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const fetchFiles = async () => {
			try {
				if (PREVIEW_IDS.length === 0) {
					return;
				}
				const res = await fetch(
					`${API_BASE}/api/get_preview/${PREVIEW_IDS.join(",")}`
				);
				const data = await res.json();
				for (const key in data) {
					data[key]["age"] = Number(data[key]["age"]);
					setPreviewMetadata((prev) => {
						return {
							...prev,
							[key]: data[key],
						};
					});
				}

				setLoading(false);
			} catch (e) {
				console.error(e);
			}
		};
		fetchFiles();
	}, [PREVIEW_IDS]);

	const handleAboutClick = () => {
		aboutRef.current?.scrollIntoView({ behavior: "smooth" });
	};


	// if ((type.toLowerCase() !== "test" && type?.toLowerCase() !== "train") )
	// return null;
	const [searchId, setSearchId] = useState<number>(0);	
	return (
		<div className="flex gap-4 flex-col text-white relative min-h-screen">
			<Header handleAboutClick={handleAboutClick} />
			<div className="flex flex-col gap-3 p-4 justify-center items-center w-screen">
				{/* Upload & inference */}
				<div className="w-full max-w-md">
					<div className="text-lg font-bold mb-3 text-center">Upload Your CT Scan</div>
					<InferenceUpload />
				</div>
				<hr className="w-screen opacity-30" />

				<div className="text-2xl flex items-center gap-2 font-bold">
					<div>Previews</div>
					<div
						className="cursor-pointer flex items-center gap-1 border-1 bg-gray-800 p-1 rounded text-sm hover:bg-gray-700"
						onClick={() => {
							const newIds = Array.from({ length: 5 }, () => generateId());
							SET_PREVIEW_IDS(newIds);
						}}
					>
						Shuffle
						<IconArrowsShuffle />
					</div>
				</div>
				<div className="flex justify-center gap-2 items-center w-1/2">
				Search ID
				<input
					type="number"
					className="rounded border-1 p-1 w-1/8"
					min={1}
					max={9901}
					value={searchId}
					onChange={(e) => setSearchId(Number(e.target.value))}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							if (searchId > 9901) {
								setSearchId(9901);
								return;
							} else if (searchId < 1) {
								setSearchId(1);
								return;
							}
							navigation("/case/" + searchId);
						}
					}}
					/>
				</div>
				<hr className="w-screen" />
				<div className="flex gap-y-4 gap-x-8 p-4 flex-wrap justify-center relative items-center w-full">
					{loading ? (
						<div className="flex z-3 items-center justify-center w-56 h-56 border border-gray-200 rounded-lg dark:border-gray-700">
							<div role="status">
								<svg
									aria-hidden="true"
									className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
									viewBox="0 0 100 101"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
										fill="currentColor"
									/>
									<path
										d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
										fill="currentFill"
									/>
								</svg>
								<span className="sr-only">Loading...</span>
							</div>
						</div>
					) : (
						PREVIEW_IDS.map((el, idx) => {
							return (
								<Preview
									key={idx.toString()}
									id={el}
									previewMetadata={previewMetadata[el]}
								></Preview>
							);
						})
					)}
				</div>
				{/* <button className="w-1/6 !bg-blue-500 rounded p-2 hover:!bg-blue-600" onClick={() => navigate("/data")}>View all cases</button> */}
			</div>
			<hr className="w-full" />
			<About aboutRef={aboutRef} />
		</div>
	);
}
