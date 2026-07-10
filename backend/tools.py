"""Generic, domain-agnostic CSV query tools exposed to the LLM as function-calling tools."""

import json
from typing import Any, Optional

import pandas as pd


class CsvTools:
    """Tools for querying a pandas DataFrame loaded from a CSV. Column-agnostic."""

    def __init__(self, dataframe: pd.DataFrame):
        self._df = dataframe

    def describe_columns(self) -> str:
        """Returns the CSV's column names, data types, and a few sample rows as JSON.

        Call this first to learn what columns exist before calling query_data.
        """
        sample = self._df.head(3).to_dict(orient="records")
        dtypes = {col: str(dtype) for col, dtype in self._df.dtypes.items()}
        return json.dumps(
            {
                "columns": list(self._df.columns),
                "dtypes": dtypes,
                "row_count": len(self._df),
                "sample_rows": sample,
            },
            default=str,
        )

    def query_data(
        self,
        filters: Optional[dict[str, Any]] = None,
        sort_by: Optional[str] = None,
        ascending: bool = True,
        group_by: Optional[str] = None,
        limit: int = 20,
    ) -> str:
        """Filters, sorts, groups, and limits CSV rows, returning JSON.

        Args:
          filters: Exact-match column/value pairs to filter rows by, e.g.
            {"category": "Electronics"}. Values are compared as strings.
          sort_by: Column name to sort by.
          ascending: Sort direction; ignored if sort_by is not set.
          group_by: Column name to group by, returning per-group row counts
            instead of raw rows.
          limit: Maximum number of rows/groups to return.

        Returns:
          A JSON array of row/group objects on success, or a JSON object
          {"error": "..."} if a column name is invalid.
        """
        df = self._df

        for column, value in (filters or {}).items():
            if column not in df.columns:
                return json.dumps(
                    {
                        "error": (
                            f"Unknown column '{column}'. Available columns:"
                            f" {list(df.columns)}"
                        )
                    }
                )
            df = df[df[column].astype(str) == str(value)]

        if group_by:
            if group_by not in df.columns:
                return json.dumps(
                    {
                        "error": (
                            f"Unknown column '{group_by}'. Available columns:"
                            f" {list(df.columns)}"
                        )
                    }
                )
            result = df.groupby(group_by).size().reset_index(name="count")
            if sort_by and sort_by in result.columns:
                result = result.sort_values(sort_by, ascending=ascending)
            return result.head(limit).to_json(orient="records")

        if sort_by:
            if sort_by not in df.columns:
                return json.dumps(
                    {
                        "error": (
                            f"Unknown column '{sort_by}'. Available columns:"
                            f" {list(df.columns)}"
                        )
                    }
                )
            df = df.sort_values(sort_by, ascending=ascending)

        return df.head(limit).to_json(orient="records")
