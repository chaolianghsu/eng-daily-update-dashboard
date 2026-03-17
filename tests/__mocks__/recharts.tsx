import React from "react";

const mock = (name: string) => {
  const Component = ({ children, ...props }: any) => (
    <div data-testid={name} {...props}>{children}</div>
  );
  Component.displayName = name;
  return Component;
};

export const BarChart = mock("BarChart");
export const Bar = mock("Bar");
export const XAxis = mock("XAxis");
export const YAxis = mock("YAxis");
export const CartesianGrid = mock("CartesianGrid");
export const Tooltip = mock("Tooltip");
export const Legend = mock("Legend");
export const ResponsiveContainer = mock("ResponsiveContainer");
export const ReferenceLine = mock("ReferenceLine");
export const Cell = mock("Cell");
export const LineChart = mock("LineChart");
export const Line = mock("Line");
export const ComposedChart = mock("ComposedChart");
export const Area = mock("Area");
export const ScatterChart = mock("ScatterChart");
export const Scatter = mock("Scatter");
export const ZAxis = mock("ZAxis");
export const LabelList = mock("LabelList");
