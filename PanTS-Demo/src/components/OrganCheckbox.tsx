import type { Color } from "@cornerstonejs/core/dist/types/types";
import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import {
	MiscColorMap, OrganSystems,
	OrganSystemsArray,
	segmentation_categories
} from "../helpers/constants";
import { deepIsEqual } from "../helpers/utils";
import {
	type AllSystems,
	type OrganSystemsAllType,
	type SubSystems,
	type Systems,
} from "../types";

type ChipBoxProps = {
	labelColorMap: { [key: number]: number[] };
	system: AllSystems;
	setCheckState: React.Dispatch<React.SetStateAction<boolean[]>>;
	checkState: boolean[];
	level: number;
	OrganSystem: OrganSystemsAllType;
};

type Props = {
	labelColorMap: { [key: number]: Color };
	setCheckState: React.Dispatch<React.SetStateAction<boolean[]>>;
	checkState: boolean[];
	sessionId: string | undefined;
	setShowTaskDetails: React.Dispatch<React.SetStateAction<boolean>>;
	setShowOrganDetails: React.Dispatch<React.SetStateAction<boolean>>;
	showOrganDetails: boolean;
};

const getOrganIdx = (organ: string) => {
	for (let i = 0; i < segmentation_categories.length; i++) {
		if (segmentation_categories[i] === organ) {
			return i;
		}
	}
	return 0;
};

function Checked({
	OrganSystem,
	system,
	labelColorMap,
	checkState,
	setCheckState,
	level = 0,
}: ChipBoxProps) {
	const [collapsed, setCollapsed] = useState(false);
	const [partialToggled, setPartialToggled] = useState(true);
	const updateToggle = (toggled: boolean) => {
		if (!OrganSystem[system]) return;
		const newCheckState = [...checkState];
		OrganSystem[system].forEach((sub) => {
			if (typeof sub === "string") {
				newCheckState[getOrganIdx(sub) + 1] = toggled;
				console.log(toggled);
				return;
			}
			const key: SubSystems = Object.keys(sub)[0] as SubSystems;
			const suborgans = sub[key];
			if (!suborgans) return newCheckState;
			suborgans.forEach(
				(suborgan) => (newCheckState[getOrganIdx(suborgan) + 1] = toggled)
			);
			// return newCheckState;
		});
		if (!deepIsEqual(newCheckState, checkState)) {
			setCheckState(newCheckState);
		}
	};

	useEffect(() => {
		if (!OrganSystem[system]) return;
		let flag = false;
		OrganSystem[system].forEach((sub) => {
			if (typeof sub === "string") {
				if (checkState[getOrganIdx(sub) + 1] === true) {
					flag = true;
					if (partialToggled !== true) setPartialToggled(true);
					return;
				}
			}
		});
		if (flag === false) setPartialToggled(false);
	}, [checkState, OrganSystem, system, partialToggled, setPartialToggled]);
  let color = null;
  if (system === "Pancreas" || system === "Kidneys") {
    color = MiscColorMap[system];
    color = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
  }

	if (!OrganSystem[system] || level > 1) return null;
	return (
		<div className={`flex gap-2 flex-col ${level === 0 ? "" : "pl-3"}`}>
			<div className="flex justify-between items-center">
				{!color ? (
					<>
						<div
							className={`flex items-center gap-2 cursor-pointer`}
							onClick={() => setCollapsed((prev) => !prev)}
						>
							<IconChevronRight
								className={`cursor-pointer text-white hover:bg-gray-700 rounded-md flex items-center justify-center transition-all duration origin-center ${
									collapsed ? "rotate-90" : ""
								}`}
							/>
							<div
								className={`text-white text-lg`}
							>
								{system}
							</div>
						</div>
						<input
							type="checkbox"
							className="w-4 h-4 text-blue-600 !bg-gray-700 border-gray-600 !rounded-sm focus:ring-blue-600 ring-offset-gray-800 focus:ring-2"
							checked={partialToggled}
							onChange={() => {
								updateToggle(!partialToggled);
							}}
						/>
					</>
				) : (
					<>
						<div
							className={`flex items-center gap-1 mb-1 cursor-pointer`}
							onClick={() => setCollapsed((prev) => !prev)}
						>
							<IconChevronRight
								className={`cursor-pointer text-white hover:bg-gray-700 rounded-md flex items-center justify-center transition-all duration origin-center ${
									collapsed ? "rotate-90" : ""
								}`}
							/>
							<div
								className={`text-white text-md rounded-md p-1 cursor-pointer hover:border-2 ${
										!partialToggled
											? "border-0"
											: "border-2"
                }`}
                style={{borderColor: color}}
                onClick={(e) => {
                  e.stopPropagation();
                  updateToggle(!partialToggled);
                }}
							>
								{system}
							</div>
						</div>
					</>
				)}
			</div>
			<div
				className={`flex flex-col gap-2 transition-all duration-100 origin-top ${
					!collapsed ? "hidden scale-y-0" : "scale-y-100"
				}`}
			>
				{OrganSystem[system].map((organ, idx) => {
					if (typeof organ === "string") {
						const color = labelColorMap[getOrganIdx(organ) + 1];
						const rgb = color
							? `rgb(${color[0]}, ${color[1]}, ${color[2]})`
							: "gray";
						if (organ == "pancreas") return null;
						return (
							<div className={`flex items-center gap-2 ${level == 0 ? "pl-8" : "pl-9"} `} key={idx}>
								<div className="cursor-pointer text-white hover:bg-gray-700 rounded-md flex items-center justify-center transition-all duration origin-center" />
								<div
									className={`text-white text-md rounded-md p-1 cursor-pointer hover:border-2 ${
										!checkState[getOrganIdx(organ) + 1]
											? "border-0"
											: "border-2"
									}`}
									style={{ borderColor: rgb }}
									onClick={() => {
										setCheckState((prev) => {
											const newCheckState = [...prev];
											newCheckState[getOrganIdx(organ) + 1] =
												!newCheckState[getOrganIdx(organ) + 1];
											return newCheckState;
										});
									}}
								>
									{organ}
								</div>
							</div>
						);
					} else if (
						typeof organ === "object" &&
						Object.keys(organ).length === 1
					) {
						const organKey: AllSystems = Object.keys(organ)[0] as AllSystems;
						return (
							<>
								<Checked
									key={Object.keys(organ)[0]}
									OrganSystem={organ}
									system={organKey}
									labelColorMap={labelColorMap}
									checkState={checkState}
									setCheckState={setCheckState}
									level={level + 1}
								/>
							</>
						);
					}
				})}
			</div>
		</div>
	);
}

function OrganCheckbox({
	setCheckState,
	checkState,
	labelColorMap,
	setShowTaskDetails,
	setShowOrganDetails,
	showOrganDetails,
}: Props) {
	const toggleAll = () => {
		setCheckState((prev) => {
			let newState = [...prev];
			const trueCount = newState.filter((val) => val === true).length;
			if (trueCount > newState.length / 2) {
				newState = newState.map(() => false);
			} else {
				newState = newState.map(() => true);
			}
			return newState;
		});
	};

	return (
		<div
			className={`flex w-2xs h-screen flex-col gap-4 p-3 z-5 absolute top-0 left-0 bg-[#0f0824] duration-100 transition-all ${
				showOrganDetails ? "translate-x-0" : "-translate-x-full"
			} origin-left`}
		>
			<div className="flex justify-between items-center w-full">

			<div className="flex gap-4 items-center justify-start">
				<IconArrowLeft
					className="cursor-pointer text-white hover:bg-gray-700 rounded-md flex items-center justify-center"
					onClick={() => {
						setShowTaskDetails(false);
						setShowOrganDetails(false);
					}}
					/>
			<div className="text-white text-2xl">Organs</div>
			</div>
			<button className="!p-1.5 !bg-gray-700" onClick={() => toggleAll()}>
				Toggle all
			</button>
			</div>
			<div className="flex flex-col gap-2 overflow-scroll">
				{OrganSystemsArray.map((system: Systems, idx) => {
					return (
						<Checked
							level={0}
							OrganSystem={OrganSystems}
							key={idx}
							system={system}
							labelColorMap={labelColorMap}
							checkState={checkState}
							setCheckState={setCheckState}
						/>
					);
				})}
			</div>
			<div className="w-full"></div>
		</div>
	);
}
export default OrganCheckbox;
