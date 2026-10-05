#!/usr/bin/env python3
"""BE-45: refit the GIS/Allowance reduction segments to one published quarter.

Usage:
  python3 scripts/gis-refit.py <dir-with-csvs> <quarter-tag>
  e.g. python3 scripts/gis-refit.py /tmp/gis october2026

The directory holds ESDC open-data tables 1-4 for that quarter
(https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0),
named as published, e.g. table1_gis_for_single_who_receives_oas_pension_october2026.csv.
Table 5 figures (maximums, cut-offs, top-up cut-offs) are read from the CSVs'
first rows and last brackets; check them against the quarterly page.

It prints segments in the shape src/engine/rules/index.ts expects, each
category's worst monthly deviation (measured like the tests: both ends of every
bracket), and checks the 42,xxx Allowance hand-off. The slopes are statutory;
only breakpoints move between quarters.
"""
import csv, glob, sys

INF = float('inf')

def load(directory, stem, tag):
    path = glob.glob(f'{directory}/{stem}_{tag}.csv')[0]
    rows = list(csv.reader(open(path, encoding='utf-8-sig')))
    return [[float(x) for x in r] for r in rows[1:] if r]

def reduction(segments, income):
    total, lower = 0.0, 0.0
    for rate, upper in segments:
        total += max(0.0, min(income, upper) - lower) * rate
        lower = upper
        if income <= upper:
            break
    return total

def monthly(segments, maximum, income):
    return max(0.0, maximum * 12 - reduction(segments, income)) / 12

def closing_rate(prefix, maximum, cutoff):
    start = prefix[-1][1]
    return (maximum * 12 - reduction(prefix, start)) / (cutoff - start)

def worst(table, amount, column):
    deviation = 0.0
    for row in table:
        for income in (row[3], row[4] + 0.01):
            published = column(row) if callable(column) else row[column]
            deviation = max(deviation, abs(amount(income) - published))
    return deviation

def main(directory, tag):
    t1 = load(directory, 'table1_gis_for_single_who_receives_oas_pension', tag)
    t2 = load(directory, 'table2_gis_for_spouse_of_someone_receiving_oas_pension', tag)
    t3 = load(directory, 'table3_gis_for_spouse_of_someone_who_does_not_receive_oas_pension', tag)
    t4 = load(directory, 'table4_gis_and_allowance_for_couple', tag)
    single, pair, allowance = t1[0][5], t2[0][5], t4[0][8]
    cut_single, cut_both = t1[-1][4] + 0.01, t2[-1][4] + 0.01
    cut_neither, cut_allowance = t3[-1][4] + 0.01, t4[-1][4] + 0.01
    top_single, top_neither, top_allowance = float(input('single top-up cut-off (Table 5): ')), float(input('spouse-with-neither top-up cut-off: ')), 8800.0
    plateau = t4[-1][5]
    best = None
    for b1 in range(1600, 2600, 8):
        pre = [(0.5, b1), (0.75, top_single)]
        segs = pre + [(closing_rate(pre, single, cut_single), INF)]
        score = worst(t1, lambda i: monthly(segs, single, i), 5)
        best = min(best or (score, segs), (score, segs), key=lambda x: x[0])
    print('single', best)
    best = None
    for b1 in range(3600, 4600, 8):
        pre = [(0.5, b1), (0.75, top_allowance)]
        segs = pre + [(closing_rate(pre, 2 * pair, cut_both), INF)]
        score = worst(t2, lambda i: monthly(segs, 2 * pair, i) / 2, 5)
        best = min(best or (score, segs), (score, segs), key=lambda x: x[0])
    print('both pensioners (per pensioner deviation; household is double)', best)
    best = None
    for a in range(3900, 4300, 4):
        for c in range(11900, 12500, 4):
            d = c + (pair * 12 - plateau * 12 - 0.125 * (top_allowance - a)) / 0.25
            gis = [(0, a), (0.125, top_allowance), (0, c), (0.25, d), (0, INF)]
            pre = [(0.75, a), (0.875, top_allowance), (0.75, c)]
            alw = pre + [(closing_rate(pre, allowance, cut_allowance), INF)]
            total = worst(t4, lambda i: monthly(gis, pair, i) + (monthly(alw, allowance, i) if i < cut_allowance else 0), lambda r: r[5] + r[8])
            alone = worst(t4, lambda i: monthly(alw, allowance, i) if i < cut_allowance else 0, 8)
            score = max(total, alone)
            if best is None or score < best[0]:
                best = (score, gis, alw)
    print('allowance couple (GIS side, Allowance)', best)
    best = None
    for a in range(3800, 4400, 4):
        b = -(single * 12 - plateau * 12 + 0.125 * a - 0.375 * top_neither - 0.25 * (cut_allowance - top_neither)) / 0.25
        if not a < b < top_neither:
            continue
        pre = [(0, a), (0.125, round(b, 2)), (0.375, top_neither), (0.25, cut_allowance)]
        segs = pre + [(closing_rate(pre, single, cut_neither), INF)]
        score = worst(t3, lambda i: monthly(segs, single, i), 5)
        if best is None or score < best[0]:
            best = (score, segs, monthly(segs, single, cut_allowance), plateau)
    print('spouse with neither (deviation, segments, value at hand-off, Allowance-row plateau)', best)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
