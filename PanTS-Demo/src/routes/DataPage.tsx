import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import About from "../components/About";
import Header from "../components/Header";
import { API_BASE, ITEMS_PER_DATA_PAGE } from "../helpers/constants";
import type { PreviewType } from "../types";
export default function DataPage() {
	const [page, setPage] = useState<number>(0);
	const [previewMetadata, setPreviewMetadata] = useState<{
		[key: string]: PreviewType;
	}>({});

	const PREVIEW_IDS = Array.from(
		{ length: ITEMS_PER_DATA_PAGE },
		(_, i) => page * ITEMS_PER_DATA_PAGE + i + 1
	);

	const navigate = useNavigate();

	const params = useParams<{ page: string; type: string }>();
	const type = params.type || "train";

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const pageNum = Number(params.get("pg"));
		console.log(pageNum)
		if (!Number.isNaN(pageNum) && Number.isInteger(pageNum) && pageNum >= 0) {
			setPage(pageNum);
		}
	}, []);

	useEffect(() => {
		const fetchFiles = async () => {
			try {
				const res = await fetch(
					`${API_BASE}/api/get_preview/${PREVIEW_IDS.join(",")}`
				);
				const data = await res.json();
                console.log(data)
				for (const key in data) {   
					data[key]["age"] = Number(data[key]["age"]);
					setPreviewMetadata((prev) => {
						return {
							...prev,
							[key]: data[key],
						};
					});
				}
			} catch (e) {
				console.error(e);
			}
		};
		fetchFiles();
	}, [PREVIEW_IDS]);

	const aboutRef = useRef<HTMLDivElement>(null);

	const handleSubmit = () => {
    if (pageUser && !Number.isNaN(Number(pageUser)) && Number(pageUser) > 0) {
      // Navigate or call your function
      // Example: change window location
	  console.log("hit")
      window.location.href = `/data?pg=${Math.floor(Number(pageUser) / 50)-1}`;
    } else {
      alert("Please enter a valid number");
    }
  };

	const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleSubmit();
		}
	};

    const [pageUser, setPageUser] = useState<string>("Enter case number");

	if (type.toLowerCase() !== "test" && type?.toLowerCase() !== "train")
		return null;

	return (
		<div className="flex gap-10 flex-col text-white relative min-h-screen">
			<Header />
			<div className="flex gap-2 items-center justify-center">
			<IconChevronLeft className="cursor-pointer" onClick={() => window.location.href = `/data?pg=${page - 1}`}/>
            <div className="text-2xl text-center font-bold">
				Cases {page * ITEMS_PER_DATA_PAGE + 1} - {page * ITEMS_PER_DATA_PAGE + ITEMS_PER_DATA_PAGE}
			</div>
			<IconChevronRight className="cursor-pointer" onClick={() => window.location.href = `/data?pg=${page + 1}`}/>	
			<input className="border rounded p-2 text-white w-2/12" type="number" placeholder="Search for a case"  value={pageUser} onChange={(e) => setPageUser(e.target.value)} onKeyDown={handleKeyPress}/>
			</div>
			<div className="grid grid-cols-5 gap-4 justify-center items-center w-screen px-8">
                
				{PREVIEW_IDS.map((id) => {
                    if (!previewMetadata[id]) return null;
                    return (
					<div className="flex flex-col gap-0.5 justify-center hover:shadow-sm shadow-white items-center border rounded bg-blue-950 p-4 cursor-pointer hover:bg-blue-900" onClick={() => navigate(`/case/${id}`)}>
						<p className="text-lg font-bold">Case {id}</p>
						<p className="text-sm">Type: {id >= 9000 ? "Test" : "Train"} set</p>
						<p className="text-sm">Age: {previewMetadata[id].age === 0 ? "-" : previewMetadata[id].age ?? "-"}</p>
						<p className="text-sm">Sex: {previewMetadata[id].sex ?? "-"}</p>
					</div>
				)})}
			</div>
			<hr className="w-full" />
			<About aboutRef={aboutRef} />
		</div>
	);
}
