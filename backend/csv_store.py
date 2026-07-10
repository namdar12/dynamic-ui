"""Loads the CSV configured via CSV_PATH into a pandas DataFrame."""

import pandas as pd


class CsvLoadError(Exception):
    """Raised when the configured CSV_PATH cannot be loaded."""


def load_dataframe(csv_path: str) -> pd.DataFrame:
    """Loads a CSV file into a DataFrame, raising CsvLoadError on failure."""
    try:
        return pd.read_csv(csv_path)
    except FileNotFoundError as e:
        raise CsvLoadError(
            f"CSV file not found at '{csv_path}'. Set CSV_PATH to a valid file."
        ) from e
    except pd.errors.EmptyDataError as e:
        raise CsvLoadError(f"CSV file at '{csv_path}' is empty.") from e
    except pd.errors.ParserError as e:
        raise CsvLoadError(f"CSV file at '{csv_path}' could not be parsed: {e}") from e
