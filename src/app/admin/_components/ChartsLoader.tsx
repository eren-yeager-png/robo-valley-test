"use client";

import dynamic from "next/dynamic";

// Recharts is only downloaded when a page that shows a chart is opened (Overview, Reports).
const Chart = dynamic(() => import("./Charts"), {
  ssr: false,
  loading: () => <div className="adm-chart adm-note" role="status">Loading chart…</div>,
});

export default Chart;
