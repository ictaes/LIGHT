import {ChartJSNodeCanvas} from "chartjs-node-canvas";
import type {Chart, ChartConfiguration, TimeUnit, _adapters} from "chart.js";
import {enGB} from "date-fns/locale/en-GB";
import type {Day} from "date-fns";

//chart.js attaches its date-adapter registry to the Chart class at runtime but marks it @private, so it is
//absent from the published typings (the `_adapters` value itself is exported, hence `typeof _adapters` to
//borrow chart.js's own signature for the one static we touch). We cannot import that value and override it
//directly: chartjs-node-canvas loads a separate chart.js instance per canvas, so the adapter has to be
//installed on the exact instance handed to chartCallback.
type ChartWithAdapters = typeof Chart & {_adapters: typeof _adapters};

function overrideDateAdapter(chartJS: typeof Chart, fns: typeof import("date-fns")): void {
	(chartJS as ChartWithAdapters)._adapters._date.override(getDateAdapter(fns));
}

const width = 500;
const height = 300;

const bgColors = ["rgba(54, 162, 235, 0.5)", "rgba(255, 159, 64, 0.5)", "rgba(75, 192, 192, 0.5)", "rgba(153, 102, 255, 0.5)", "rgba(255, 99, 132, 0.5)", "rgba(255, 205, 86, 0.5)", "rgba(201, 203, 207, 0.5)", "rgba(255, 99, 132, 0.5)", "rgba(54, 162, 235, 0.5)", "rgba(255, 159, 64, 0.5)"];
const borderColors = ["rgb(54, 162, 235)", "rgb(255, 159, 64)", "rgb(75, 192, 192)", "rgb(153, 102, 255)", "rgb(255, 99, 132)", "rgb(255, 205, 86)", "rgb(201, 203, 207)", "rgb(255, 99, 132)", "rgb(54, 162, 235)", "rgb(255, 159, 64)"];

let canvasNormal: ChartJSNodeCanvas;
let canvasWide: ChartJSNodeCanvas;
let darkCanvasWide: ChartJSNodeCanvas;

import("date-fns").then((fns) => {
	canvasNormal = new ChartJSNodeCanvas({
		width, height, backgroundColour: "white", chartCallback: (ChartJS) => overrideDateAdapter(ChartJS, fns)
	});
	canvasWide = new ChartJSNodeCanvas({
		width: 3 * width, height: 1.5 * height, backgroundColour: "white", chartCallback: (ChartJS) => overrideDateAdapter(ChartJS, fns)
	});
	darkCanvasWide = new ChartJSNodeCanvas({
		width: 3 * width, height: 1.5 * height, backgroundColour: "#212529", chartCallback: (ChartJS) => overrideDateAdapter(ChartJS, fns)
	});
});

export async function renderDualChart(data: { day: string, wins: number, points: number }[]): Promise<Buffer> {
	const config = {
		type: "line",
		data: {
			labels: data.map(d => d.day),
			datasets: [
				{label: "Points", data: data.map(d => d.points), yAxisID: "A", backgroundColor: bgColors[0], borderColor: borderColors[0]},
				{label: "Wins", data: data.map(d => d.wins), yAxisID: "B", backgroundColor: bgColors[1], borderColor: borderColors[1]}
			]
		},
		options: {
			scales: {
				A: {
					type: "linear",
					display: true,
					position: "left"
				},
				B: {
					type: "linear",
					display: true,
					position: "right",
					grid: {
						drawOnChartArea: false
					}
				}
			}
		}
	} satisfies ChartConfiguration<"line">;
	return await canvasNormal.renderToBuffer(config);
}

export async function renderClanChart(data: { label: number, score: number, line: string }[], dark: boolean): Promise<Buffer> {
	let lineData: { label: string, data: { x: number, y: number }[], backgroundColor: string, borderColor: string }[] = [];
	for (const entry of data) {
		let clan = entry.line;
		let clanData = lineData.find((data) => data.label === clan);
		if (!clanData) {
			clanData = {
				label: clan,
				data: [],
				backgroundColor: bgColors[lineData.length % bgColors.length],
				borderColor: borderColors[lineData.length % borderColors.length]
			};
			lineData.push(clanData);
		}
		clanData.data.push({
			x: entry.label,
			y: entry.score
		});
	}
	const config = {
		type: "line",
		data: {
			datasets: lineData
		},
		options: {
			scales: {
				x: {
					type: "time",
					time: {
						displayFormats: {
							second: "HH:mm:ss",
							minute: "HH:mm",
							hour: "HH:mm",
							day: "dd.MM.yy",
							week: "dd.MM.yy",
							month: "MMMM yy",
							quarter: "MMMM yy"
						}
					}
				},
				y: {
					title: {
						display: true,
						text: "Score"
					},
					ticks: {
						//chart.js types tick values as number | string because category scales label with
						//strings; this axis is linear, so the value is always numeric
						callback: function (value: number | string) {
							return Number(value) / 10000
						}
					}
				}
			},
			plugins: {
				title: {
					display: true,
					text: "Clan score over time",
					font: {
						size: 24
					}
				},
				subtitle: {
					display: true,
					text: " ~ BetterTT by @platz1de",
					position: "bottom",
					align: "end"
				}
			},
			elements: {
				point: {
					radius: 0
				}
			}
		}
	} satisfies ChartConfiguration<"line">;
	const canvas = dark ? darkCanvasWide : canvasWide;
	return await canvas.renderToBuffer(config);
}

//chart.js hands startOf("isoWeek") its options.time.isoWeekday: either a 0-6 weekday index, or a boolean
//where true means Monday and false means Sunday. date-fns only accepts 0-6, so fold the boolean form in.
function toWeekStart(weekday?: number | boolean): Day {
	if (typeof weekday !== "number") return weekday ? 1 : 0;
	return (((weekday % 7) + 7) % 7) as Day; //the modulo guarantees 0-6, but tsc cannot narrow that
}

function getDateAdapter(fns: typeof import("date-fns")) {
	return {
		formats: () => {
			//chart.js falls back to these whenever a scale's displayFormats has no entry for the unit it
			//picked, so every TimeUnit (plus "datetime") needs one - a missing entry reaches date-fns as an
			//undefined format string and throws.
			return {
				millisecond: "HH:mm:ss.SSS",
				second: "HH:mm:ss",
				minute: "HH:mm",
				hour: "HH:mm",
				day: "dd.MM.yy",
				week: "dd.MM.yy",
				month: "MMMM yy",
				quarter: "MMMM yy",
				year: "yyyy",
				datetime: "dd.MM.yy HH:mm:ss"
			}
		},
		parse: function (value: unknown) {
			//chart.js only reaches for the adapter when the raw value is not already a finite timestamp, and
			//parseISO needs a string - anything else (a Date, an object) is not something we can read.
			if (typeof value !== "string") return null;
			let date = fns.parseISO(value);
			return fns.isValid(date) ? date.getTime() : null;
		},
		//the second argument is a date-fns pattern out of formats()/scale displayFormats (e.g. "dd.MM.yy"),
		//not a TimeUnit - chart.js has already resolved the unit to its format string by this point
		format: function (timestamp: number, format: string) {
			return fns.format(timestamp, format, {locale: enGB});
		},
		//date-fns returns Date objects, but chart.js's adapter contract is timestamps - hence .getTime()
		add: function (time: number, amount: number, unit: TimeUnit): number {
			switch (unit) {
				case "millisecond":
					return fns.addMilliseconds(time, amount).getTime();
				case "second":
					return fns.addSeconds(time, amount).getTime();
				case "minute":
					return fns.addMinutes(time, amount).getTime();
				case "hour":
					return fns.addHours(time, amount).getTime();
				case "day":
					return fns.addDays(time, amount).getTime();
				case "week":
					return fns.addWeeks(time, amount).getTime();
				case "month":
					return fns.addMonths(time, amount).getTime();
				case "quarter":
					return fns.addQuarters(time, amount).getTime();
				case "year":
					return fns.addYears(time, amount).getTime();
				default:
					return time;
			}
		},
		diff: function (a: number, b: number, unit: TimeUnit) {
			switch (unit) {
				case "millisecond":
					return fns.differenceInMilliseconds(a, b);
				case "second":
					return fns.differenceInSeconds(a, b);
				case "minute":
					return fns.differenceInMinutes(a, b);
				case "hour":
					return fns.differenceInHours(a, b);
				case "day":
					return fns.differenceInDays(a, b);
				case "week":
					return fns.differenceInWeeks(a, b);
				case "month":
					return fns.differenceInMonths(a, b);
				case "quarter":
					return fns.differenceInQuarters(a, b);
				case "year":
					return fns.differenceInYears(a, b);
				default:
					return 0;
			}
		},
		startOf: function (timestamp: number, unit: TimeUnit | "isoWeek", weekday?: number | boolean): number {
			switch (unit) {
				case "second":
					return fns.startOfSecond(timestamp).getTime();
				case "minute":
					return fns.startOfMinute(timestamp).getTime();
				case "hour":
					return fns.startOfHour(timestamp).getTime();
				case "day":
					return fns.startOfDay(timestamp).getTime();
				case "week":
					return fns.startOfWeek(timestamp).getTime();
				case "isoWeek":
					return fns.startOfWeek(timestamp, {weekStartsOn: toWeekStart(weekday)}).getTime();
				case "month":
					return fns.startOfMonth(timestamp).getTime();
				case "quarter":
					return fns.startOfQuarter(timestamp).getTime();
				case "year":
					return fns.startOfYear(timestamp).getTime();
				default:
					return timestamp;
			}
		},
		endOf: function (timestamp: number, unit: TimeUnit | "isoWeek"): number {
			switch (unit) {
				case "second":
					return fns.endOfSecond(timestamp).getTime();
				case "minute":
					return fns.endOfMinute(timestamp).getTime();
				case "hour":
					return fns.endOfHour(timestamp).getTime();
				case "day":
					return fns.endOfDay(timestamp).getTime();
				case "week":
					return fns.endOfWeek(timestamp).getTime();
				case "month":
					return fns.endOfMonth(timestamp).getTime();
				case "quarter":
					return fns.endOfQuarter(timestamp).getTime();
				case "year":
					return fns.endOfYear(timestamp).getTime();
				default:
					return timestamp;
			}
		}
	}
}