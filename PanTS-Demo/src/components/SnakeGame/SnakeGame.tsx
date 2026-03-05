import { useCallback, useEffect, useRef, useState } from "react";

const COLs = 32;
const ROWs = 32;
const DEFAULT_LENGTH = 10;

const UP = Symbol("up");
const DOWN = Symbol("down");
const RIGHT = Symbol("right");
const LEFT = Symbol("left");

interface SnakeCoordinate {
    row: number;
    col: number;
    isHead: boolean;
}
function SnakeGame() {
    const timer = useRef<NodeJS.Timeout | null>(null);
    const grid = useRef(Array(ROWs).fill(Array(COLs).fill("")));
    const snakeCoordinates = useRef<SnakeCoordinate[]>([]);
    const direction = useRef<Symbol>(RIGHT);
    const snakeCoordinatesMap = useRef(new Set());
    const foodCoords = useRef({
        row: -1,
        col: -1,
    });
    const [points, setPoints] = useState(0);
    const [gameOver, setGameOver] = useState(false);
    const [isPlaying, setPlaying] = useState(0);

    useEffect(() => {
        window.addEventListener("keydown", (e) => handleDirectionChange(e.key));
    }, []);

    useEffect(() => {
        // Default snake length is 4 cell
        const snake_postions = [];
        for (let i = 0; i < DEFAULT_LENGTH; i++) {
            snake_postions.push({
                row: 0,
                col: i,
                isHead: false,
            });
        }

        snake_postions[DEFAULT_LENGTH - 1].isHead = true;
        snakeCoordinates.current = snake_postions;

        syncSnakeCoordinatesMap();
        populateFoodBall();
    }, []);

    const handleDirectionChange = (key: string) => {
        if (key === "ArrowUp" && direction.current === DOWN) return;
        if (key === "ArrowDown" && direction.current === UP) return;
        if (key === "ArrowRight" && direction.current === LEFT) return;
        if (key === "ArrowLeft" && direction.current === RIGHT) return;
        direction.current = getNewDirection(key);
    };

    const getNewDirection = (key: string): Symbol => {
        switch (key) {
            case "ArrowUp":
                return UP;
            case "ArrowDown":
                return DOWN;
            case "ArrowRight":
                return RIGHT;
            case "ArrowLeft":
                return LEFT;
            default:
                return direction.current;
        }
    };

    const syncSnakeCoordinatesMap = () => {
        const snakeCoordsSet = new Set(
            snakeCoordinates.current.map((coord) => `${coord.row}:${coord.col}`)
        );
        snakeCoordinatesMap.current = snakeCoordsSet;
    };

    const moveSnake = () => {
        if (gameOver) return;

        setPlaying((s) => s + 1);

        const coords = snakeCoordinates.current;
        const snakeTail = coords[0];
        const snakeHead = coords.pop();
        if (!snakeHead) return;
        const curr_direction = direction.current;

        // Check for food ball consumption
        const foodConsumed =
            snakeHead.row === foodCoords.current.row &&
            snakeHead.col === foodCoords.current.col;

        // Update body coords based on direction and its position
        coords.forEach((_, idx) => {
            // Replace last cell with snake head coords [last is the cell after snake head]
            if (idx === coords.length - 1) {
                coords[idx] = { ...snakeHead };
                coords[idx].isHead = false;
                return;
            }

            // Replace current cell coords with next cell coords
            coords[idx] = coords[idx + 1];
        });

        // Update snake head coords based on direction
        switch (curr_direction) {
            case UP:
                snakeHead.row -= 1;
                break;
            case DOWN:
                snakeHead.row += 1;
                break;
            case RIGHT:
                snakeHead.col += 1;
                break;
            case LEFT:
                snakeHead.col -= 1;
                break;
        }

        // If food ball is consumed, update points and new position of food
        if (foodConsumed) {
            setPoints((points) => points + 1);
            populateFoodBall();
        }

        // If there is no collision for the movement, continue the game
        const collided = collisionCheck(snakeHead);
        if (collided) {
            stopGame();
            return;
        }

        // Create new coords with new snake head
        coords.push(snakeHead);
        snakeCoordinates.current = foodConsumed
            ? [snakeTail, ...coords]
            : coords;
        syncSnakeCoordinatesMap();
    };

    const collisionCheck = (snakeHead: SnakeCoordinate) => {
        // Check wall collision
        if (
            snakeHead.col >= COLs ||
            snakeHead.row >= ROWs ||
            snakeHead.col < 0 ||
            snakeHead.row < 0
        ) {
            return true;
        }

        // Check body collision
        const coordsKey = `${snakeHead.row}:${snakeHead.col}`;
        if (snakeCoordinatesMap.current.has(coordsKey)) {
            return true;
        }
    };

    const populateFoodBall = async () => {
        const row = Math.floor(Math.random() * ROWs);
        const col = Math.floor(Math.random() * COLs);

        foodCoords.current = {
            row,
            col,
        };
    };

    const startGame = async () => {
        setGameOver(false);
        setPlaying(1);
        setPoints(0);
        const interval = setInterval(() => {
            moveSnake();
        }, 110);

        timer.current = interval;
    };

    const stopGame = async () => {
        setGameOver(true);
        setPlaying(0);
        if (timer.current) {
            clearInterval(timer.current);
        }
    };

    const getCell = useCallback(
        (row_idx: number, col_idx: number) => {
            const coords = `${row_idx}:${col_idx}`;
            const foodPos = `${foodCoords.current.row}:${foodCoords.current.col}`;
            const head =
                snakeCoordinates.current[snakeCoordinates.current.length - 1];
            const headPos = `${head?.row}:${head?.col}`;

            const isFood = coords === foodPos;
            const isSnakeBody = snakeCoordinatesMap.current.has(coords);
            const isHead = headPos === coords;

            let className = "w-3 h-3 flex justify-center items-center border-l border-t border-white border-dotted";
            if (isFood) {
                className += " bg-red-600 z-10 border-red-600 rounded-md shadow-md";
            }
            if (isSnakeBody) {
                className += " bg-[#3842ff] border-[#3842ff]";
            }
            if (isHead) {
                className += " head";
            }
            // if its last row or last col make it have border
            if (row_idx === ROWs - 1) {
                className += " border-b";
            }
            if (col_idx === COLs - 1) {
                className += " border-r";
            }
            return <div key={col_idx} className={className}></div>;
        },
        [isPlaying]
    );

    return (
        <div className="w-full h-full flex flex-col justify-center items-center">
            {gameOver ? (
                <div className="flex gap-2 items-center">
                    <p className="text-md font-bold text-[#e51919] -tracking-tight">GAME OVER</p>
                    {/* <p onClick={startGame} className="cursor-pointer">RESTART</p> */}
                </div>
            ) : (
                <button onClick={isPlaying ? stopGame : startGame}>
                    {isPlaying ? "STOP" : "START"} GAME
                </button>
            )}
            <div className="w-full h-full flex flex-col rounded-md border-2">
                {grid.current?.map((row, row_idx) => (
                    <div key={row_idx} className="flex flex-row">
                        {row.map((_: any, col_idx: number) => getCell(row_idx, col_idx))}
                    </div>
                ))}
            </div>
            <p className="text-md font-medium">SCORE {points}</p>
            {/* <div className="keys-container">
                <button onClick={() => handleDirectionChange("ArrowUp")}>
                    UP
                </button>
                <div className="key-row">
                    <button onClick={() => handleDirectionChange("ArrowLeft")}>
                        LEFT
                    </button>
                    <button onClick={() => handleDirectionChange("ArrowRight")}>
                        RIGHT
                    </button>
                </div>
                <button onClick={() => handleDirectionChange("ArrowDown")}>
                    DOWN
                </button>
            </div> */}
        </div>
    );
}

export default SnakeGame;