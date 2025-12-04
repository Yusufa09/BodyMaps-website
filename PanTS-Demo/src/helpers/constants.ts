import type { Color } from "@cornerstonejs/core/dist/types/types";
import type {
	APP_CONSTANTS_TYPE,
	cornerstoneCustomColorLUTType, MiscColorMapType,
	OrganSystemsType,
	SegmentationCategories,
	SubSystems,
	Systems
} from "../types";

export const API_BASE = import.meta.env.VITE_API_BASE;

// old
// const x = {
//   1:  [229, 68, 68, 128],
//   2:  [229, 117, 68, 128],
//   3:  [229, 165, 68, 128],
//   5:  [229, 213, 68, 128],
//   6:  [197, 229, 68, 128],
//   7:  [149, 229, 68, 128],
//   8:  [100, 229, 68, 128],
//   11: [68, 229, 84, 128],
//   12: [65, 105, 225, 255], // Kidney (royal blue)
//   13: [30, 144, 255, 255], // Kidney (dodger blue)
//   14: [68, 229, 229, 128],
//   15: [173, 216, 230, 255], // Lung (light blue)
//   16: [135, 206, 235, 255], // Lung (sky blue)
//   17: [68, 84, 229, 128],
//   18: [100, 68, 229, 128],
//   19: [149, 68, 229, 128],
//   20: [197, 68, 229, 128],
//   21: [229, 68, 213, 128],
//   23: [229, 68, 165, 128],
//   25: [229, 68, 117, 128],
//   26: [229, 117, 68, 128],
//   27: [229, 68, 68, 128],
//   28: [229, 213, 68, 128]
// }

export const segmentation_category_colors: { [key: number]: Color } = {
	1: [255, 140, 0, 255], // Dark orange
	2: [255, 165, 0, 255], // Orange
	3: [255, 0, 0, 255], // Artery (red)
	4: [0, 191, 255, 255], // Urinary system (sky blue)
	5: [220, 20, 60, 255], // Artery (crimson red)
	6: [255, 160, 202, 255], // Digestive (salmon)
	7: [34, 139, 34, 255], // Green (bile duct)
	8: [255, 127, 80, 255], // Coral (GI tract)
	9: [245, 245, 245, 255], // Bone (light gray)
	10: [220, 220, 220, 255], // Bone (gray)
	11: [0, 128, 0, 255], // Dark green
	12: [68, 229, 133, 255],
	13: [68, 229, 181, 255],
	14: [178, 34, 34, 255], // Liver (brownish red)
	15: [68, 181, 229, 255],
	16: [68, 133, 229, 255],
	17: [255, 182, 193, 255], // Pancreas (light pink)
	18: [255, 105, 180, 255], // Pancreas (hot pink)
	19: [219, 112, 147, 255], // Pancreas (pale violet red)
	20: [255, 160, 122, 255], // Pancreas general (salmon)
	21: [255, 228, 181, 255], // Light tan (duct)
	22: [139, 0, 0, 255], // Dark red (lesion)
	23: [72, 61, 139, 255], // Vein (dark slate blue)
	24: [255, 105, 180, 255], // Magenta/pink
	25: [138, 43, 226, 255], // Purple
	26: [255, 99, 71, 255], // Tomato red
	27: [255, 69, 0, 255], // Bright red-orange artery
	28: [106, 90, 205, 255], // Medium slate blue
};

export const segmentation_categories: SegmentationCategories[] = [
	"adrenal_gland_left",
	"adrenal_gland_right",
	"aorta",
	"bladder",
	"celiac_artery",
	"colon",
	"common_bile_duct",
	"duodenum",
	"femur_left",
	"femur_right",
	"gall_bladder",
	"kidney_left",
	"kidney_right",
	"liver",
	"lung_left",
	"lung_right",
	"pancreas",
	"pancreas_body",
	"pancreas_head",
	"pancreas_tail",
	"pancreatic_duct",
	"pancreatic_lesion",
	"postcava",
	"prostate",
	"spleen",
	"stomach",
	"superior_mesenteric_artery",
	"veins",
];

export const OrganSystemsArray: Systems[] = [
	"Vascular System",
	"Digestive System",
	"Endocrine System",
	"Urinary System",
	"Skeletal System",
	"Lymphatic System",
	"Reproductive System",
	"Respiratory System"
	// "Adrenal Glands",
	// "Pancreas",
	// "Kidneys",
	// "Femur",
	// "Lung",
	// "Other"
];

export const OrgansSubsystemsArray: SubSystems[] = [
	"Kidneys",
	"Pancreas"
]

export const MiscColorMap: MiscColorMapType = {
	"Kidneys": [144, 238, 200],
	"Pancreas": [244, 160, 160]
}

export const OrganSystems: OrganSystemsType = {
	"Vascular System": [
		"aorta",
		"celiac_artery",
		"superior_mesenteric_artery",
		"postcava",
		"veins",
	],
	"Endocrine System": ["adrenal_gland_left", "adrenal_gland_right"],
	"Urinary System": [{ Kidneys: ["kidney_left", "kidney_right"] }, "bladder"],
	// bladder
	"Skeletal System": ["femur_left", "femur_right"],

	"Digestive System": [
		{
			Pancreas: [
				"pancreas",
				"pancreas_body",
				"pancreas_head",
				"pancreas_tail",
				"pancreatic_duct",
				"pancreatic_lesion",
			],
		},
		"colon",
		"duodenum",
		"stomach",
		"liver",
		"common_bile_duct",
		"gall_bladder",
	],
	"Respiratory System": ["lung_left", "lung_right"],
	"Reproductive System": ["prostate"],
	"Lymphatic System": ["spleen"],
};

const RED = [230, 25, 75, 255];
const BLUE = [0, 130, 200, 255];
const MAROON = [128, 0, 0, 255];
const BROWN = [170, 110, 40, 255];
const OLIVE = [128, 128, 0, 255];
//const OLIVE = [0, 0, 0, 0];
const TEAL = [0, 128, 128, 255];
const PURPLE = [145, 30, 180, 255];
const MAGENTA = [240, 50, 230, 255];
const LIME = [50, 205, 50, 255];

const cornerstoneCustomColorLUT: cornerstoneCustomColorLUTType = {
	0: [0, 0, 0, 0], // transparent for background
	1: RED,
	2: BLUE,
	3: MAROON,
	4: BROWN,
	5: OLIVE,
	6: TEAL,
	7: PURPLE,
	8: MAGENTA,
	9: LIME,
	// Add more mappings as needed
};
const NVCmapAlpha = 128;

function createNVColorMapFromCornerstoneLUT() {
	const R: number[] = [];
	const G: number[] = [];
	const B: number[] = [];
	const A: number[] = [];
	const I: number[] = [];
	Object.keys(cornerstoneCustomColorLUT).forEach((intensity) => {
		I.push(Number(intensity));
		const RGBA = cornerstoneCustomColorLUT[Number(intensity)];
		R.push(RGBA[0]);
		G.push(RGBA[1]);
		B.push(RGBA[2]);
		if (intensity === "0") {
			A.push(0);
		} else {
			A.push(NVCmapAlpha);
		}
	});

	const cmap = {
		R: R,
		G: G,
		B: B,
		A: A,
		I: I,
	};
	return cmap;
}

export const APP_CONSTANTS: APP_CONSTANTS_TYPE = {
	DEFAULT_SEGMENTATION_OPACITY: 0.6,
	API_ORIGIN: API_BASE,
	cornerstoneCustomColorLUT: cornerstoneCustomColorLUT,
	NVCmapAlpha: NVCmapAlpha,
	NVColormap: createNVColorMapFromCornerstoneLUT(),
};

export const ITEMS_PER_DATA_PAGE = 50;
