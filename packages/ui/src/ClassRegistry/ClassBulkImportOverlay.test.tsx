import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassBulkImportOverlay } from "./ClassBulkImportOverlay";

const CSV = "class_code,description,prop_rate_number\nc101,Meridian Neighborhood Bakery,07\nc102,Meridian General Merchandise,11";

describe("<ClassBulkImportOverlay>", () => {
  it("parses pasted CSV and previews the valid count", () => {
    render(<ClassBulkImportOverlay open onCancel={() => {}} onImport={() => {}} />);
    fireEvent.change(screen.getByTestId("rater-class-import-textarea"), {
      target: { value: CSV },
    });
    expect(screen.getByText(/2 ready/)).toBeInTheDocument();
  });

  it("imports drafts (marked ISO by default, attributes routed) on submit", () => {
    const onImport = vi.fn();
    render(<ClassBulkImportOverlay open onCancel={() => {}} onImport={onImport} />);
    fireEvent.change(screen.getByTestId("rater-class-import-textarea"), {
      target: { value: CSV },
    });
    fireEvent.click(screen.getByTestId("rater-class-import-submit"));
    expect(onImport).toHaveBeenCalledOnce();
    const [rows, mode] = onImport.mock.calls[0]!;
    expect(rows).toHaveLength(2);
    expect(rows[0].class_code).toBe("c101");
    expect(rows[0].attributes.prop_rate_number).toBe("07");
    expect(rows[0].source).toBe("iso");
    expect(mode).toBe("merge");
  });

  it("switches to replace mode", () => {
    const onImport = vi.fn();
    render(<ClassBulkImportOverlay open onCancel={() => {}} onImport={onImport} />);
    fireEvent.change(screen.getByTestId("rater-class-import-textarea"), {
      target: { value: CSV },
    });
    fireEvent.click(screen.getByTestId("rater-class-import-replace"));
    fireEvent.click(screen.getByTestId("rater-class-import-submit"));
    expect(onImport.mock.calls[0]![1]).toBe("replace");
  });

  it("disables import when nothing is pasted", () => {
    render(<ClassBulkImportOverlay open onCancel={() => {}} onImport={() => {}} />);
    expect(screen.getByTestId("rater-class-import-submit")).toBeDisabled();
  });
});
