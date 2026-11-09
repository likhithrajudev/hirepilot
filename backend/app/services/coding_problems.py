"""Reviewed coding tasks with deterministic reference outputs. No AI-created tests."""
from collections import Counter, deque
import heapq

LANGUAGES = {
    "python": {"label": "Python 3", "file": "main.py", "monaco": "python"},
    "javascript": {"label": "JavaScript · Node.js", "file": "main.js", "monaco": "javascript"},
    "cpp": {"label": "C++17", "file": "main.cpp", "monaco": "cpp"},
    "java": {"label": "Java", "file": "Main.java", "monaco": "java"},
}
STARTERS = {
    "python": 'import sys\n\ndef solve(data: str) -> str:\n    # Read the problem input and return the required output.\n    return ""\n\nif __name__ == "__main__":\n    sys.stdout.write(str(solve(sys.stdin.read())))\n',
    "javascript": 'const fs = require("fs");\n\nfunction solve(input) {\n  // Read the problem input and return the required output.\n  return "";\n}\n\nprocess.stdout.write(String(solve(fs.readFileSync(0, "utf8"))));\n',
    "cpp": '#include <bits/stdc++.h>\nusing namespace std;\n\nstring solve(const string& input) {\n    // Parse input with istringstream in(input);\n    return "";\n}\n\nint main() {\n    ios::sync_with_stdio(false); cin.tie(nullptr);\n    string input((istreambuf_iterator<char>(cin)), {});\n    cout << solve(input);\n}\n',
    "java": 'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    static String solve(String input) {\n        // Parse input and return the required output.\n        return "";\n    }\n    public static void main(String[] args) throws Exception {\n        System.out.print(solve(new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));\n    }\n}\n',
}


def reference(pid, value):
    if pid == "brackets":
        stack = []
        for c in value.rstrip("\n"):
            if c in "([{": stack.append(c)
            elif not stack or stack.pop() != {")": "(", "]": "[", "}": "{"}[c]: return "NO"
        return "NO" if stack else "YES"
    if pid == "unique":
        seen, left, best = {}, 0, 0
        for right, c in enumerate(value.rstrip("\n")):
            left = max(left, seen.get(c, -1) + 1)
            seen[c] = right; best = max(best, right - left + 1)
        return str(best)
    if pid == "window":
        lines = value.split("\n"); s, t = lines[0], lines[1]
        if not t: return "0"
        need, missing, left, best = Counter(t), len(t), 0, len(s) + 1
        for right, c in enumerate(s):
            if need[c] > 0: missing -= 1
            need[c] -= 1
            while missing == 0:
                best = min(best, right - left + 1)
                need[s[left]] += 1
                if need[s[left]] > 0: missing += 1
                left += 1
        return str(best if best <= len(s) else -1)
    a = list(map(int, value.split()))
    if pid == "pairs":
        n, target = a[:2]; counts, total = Counter(), 0
        for x in a[2:2 + n]: total += counts[target - x]; counts[x] += 1
        return str(total)
    if pid == "merge_sorted":
        n, m = a[:2]
        return " ".join(map(str, sorted(a[2:2 + n + m])))
    if pid == "subarray":
        n = a[0]
        if not n: return "0"
        current = best = a[1]
        for x in a[2:1 + n]: current = max(x, current + x); best = max(best, current)
        return str(best)
    if pid == "intervals":
        merged = []
        for left, right in sorted(zip(a[1::2], a[2::2])):
            if merged and left <= merged[-1][1]: merged[-1][1] = max(merged[-1][1], right)
            else: merged.append([left, right])
        return "\n".join([str(len(merged)), *(f"{l} {r}" for l, r in merged)])
    if pid == "sliding":
        n, k = a[:2]; values, q, out = a[2:], deque(), []
        if n == 0: return ""
        for i, x in enumerate(values):
            while q and q[0] <= i - k: q.popleft()
            while q and values[q[-1]] <= x: q.pop()
            q.append(i)
            if i >= k - 1: out.append(values[q[0]])
        return " ".join(map(str, out))
    if pid == "path":
        n, m, source, target = a[:4]; graph = [[] for _ in range(n)]
        for i in range(m):
            u, v, w = a[4 + 3 * i:7 + 3 * i]; graph[u].append((v, w))
        distances = [float("inf")] * n; distances[source] = 0; q = [(0, source)]
        while q:
            distance, node = heapq.heappop(q)
            if distance != distances[node]: continue
            for dest, weight in graph[node]:
                if distance + weight < distances[dest]:
                    distances[dest] = distance + weight; heapq.heappush(q, (distance + weight, dest))
        return str(distances[target]) if distances[target] != float("inf") else "-1"
    raise ValueError("Unknown problem")


def problem(pid, title, difficulty, statement, format, constraints, inputs):
    return {"id": pid, "title": title, "difficulty": difficulty, "statement": statement, "input_format": format,
            "constraints": constraints, "cases": [{"name": name, "input": data, "expected": reference(pid, data), "hidden": i >= 2} for i, (name, data) in enumerate(inputs)]}


PROBLEMS = {p["id"]: p for p in [
    problem("pairs", "Pairs on target", "easy", "Count index pairs i < j whose values sum to the target. Duplicate values at different indices count separately. Output the pair count.",
            "First line: n target. Second line: n integers.", "0 ≤ n ≤ 100000; values and target fit signed 32-bit integers. Use a 64-bit count.",
            [("Mixed values", "5 6\n1 5 3 3 2\n"), ("Duplicates", "4 4\n2 2 2 2\n"), ("Empty", "0 0\n"), ("Single value", "1 4\n2\n"), ("Negatives", "5 0\n-2 2 -2 2 0\n"), ("No pairs", "3 20\n1 2 3\n"), ("Large count", "100000 0\n" + "0 " * 100000)]),
    problem("brackets", "Balanced boundaries", "easy", "Determine whether a sequence of (), [] and {} is correctly nested and balanced. Output YES or NO. The empty sequence is balanced.",
            "One line containing only bracket characters, possibly empty.", "0 ≤ length ≤ 100000.",
            [("Nested", "{[()]}\n"), ("Crossed", "([)]\n"), ("Empty", "\n"), ("Unclosed", "(((\n"), ("Unexpected close", ")\n"), ("Adjacent groups", "()[]{}\n"), ("Deep nesting", "(" * 50000 + ")" * 50000 + "\n")]),
    problem("merge_sorted", "Merge the feeds", "easy", "Merge two sorted integer sequences into one sorted sequence. Keep duplicates. Output the merged integers separated by spaces, or nothing if both are empty.",
            "First line: n m. Second line: n sorted integers. Third line: m sorted integers.", "0 ≤ n,m ≤ 100000; integers fit signed 32-bit values. Aim for O(n+m) time.",
            [("Interleaved", "3 3\n1 3 5\n2 4 6\n"), ("Duplicates", "2 2\n1 1\n1 2\n"), ("Both empty", "0 0\n\n\n"), ("Left empty", "0 3\n\n-3 0 2\n"), ("Right empty", "3 0\n-5 -1 4\n\n"), ("Negative values", "3 2\n-9 -2 0\n-7 -1\n")]),
    problem("subarray", "The strongest segment", "medium", "Find the maximum sum of a non-empty contiguous subarray. If the input array is empty, output 0. Output only the sum.",
            "First line: n. Second line: n integers.", "0 ≤ n ≤ 100000; |value| ≤ 1000000000. Use 64-bit sums.",
            [("Mixed", "9\n-2 1 -3 4 -1 2 1 -5 4\n"), ("All negative", "3\n-8 -2 -5\n"), ("Empty", "0\n"), ("Single", "1\n-7\n"), ("Zeros", "4\n0 0 0 0\n"), ("Large sum", "4\n1000000000 1000000000 1000000000 1000000000\n")]),
    problem("intervals", "One coherent timeline", "medium", "Merge overlapping closed intervals. Touching endpoints overlap. Return intervals sorted by start. Output the number of merged intervals, then one start/end pair per line.",
            "First line: n. Next n lines: start end.", "0 ≤ n ≤ 100000; -1000000000 ≤ start ≤ end ≤ 1000000000.",
            [("Overlapping", "4\n1 3\n2 6\n8 10\n15 18\n"), ("Touching", "2\n1 2\n2 4\n"), ("Empty", "0\n"), ("Nested", "3\n1 10\n2 3\n4 8\n"), ("Unsorted negative", "3\n5 6\n-4 -1\n-2 0\n"), ("Point duplicates", "3\n1 1\n1 1\n2 2\n")]),
    problem("unique", "A window without repeats", "medium", "Find the length of the longest contiguous substring containing no repeated characters. Spaces count as characters. Output the length.",
            "One line of printable ASCII text, possibly empty. The terminating newline is not part of the text.", "0 ≤ length ≤ 100000. Aim for O(n) time.",
            [("Repeating", "abcabcbb\n"), ("One character", "bbbbb\n"), ("Empty", "\n"), ("Left-boundary trap", "abba\n"), ("Spaces", "a b a\n"), ("All unique", "abcdef012345\n"), ("Long repeat", "a" * 100000 + "\n")]),
    problem("window", "The minimum covering window", "hard", "Find the length of the shortest substring of s containing every character in t, including duplicate requirements. Output -1 if impossible, or 0 if t is empty.",
            "First line: s. Second line: t. Both contain ASCII letters and may be empty.", "0 ≤ |s|,|t| ≤ 100000. Aim for O(|s|+|t|) time.",
            [("Covering window", "ADOBECODEBANC\nABC\n"), ("Impossible", "a\naa\n"), ("Both empty", "\n\n"), ("Empty target", "abc\n\n"), ("Duplicate requirement", "aaabcbc\naabc\n"), ("Case sensitivity", "aA\nA\n"), ("Late match", "a" * 99999 + "b\nab\n")]),
    problem("sliding", "Rolling peak", "hard", "For every contiguous window of size k, output its maximum in left-to-right order. For an empty array, output nothing.",
            "First line: n k. Second line: n integers.", "0 ≤ n ≤ 100000; 1 ≤ k ≤ n when n > 0; k=0 when n=0. Aim for O(n) time.",
            [("Mixed", "8 3\n1 3 -1 -3 5 3 6 7\n"), ("Duplicates", "4 2\n2 2 2 2\n"), ("Empty", "0 0\n"), ("Whole array", "4 4\n-4 -2 -9 -3\n"), ("Unit window", "3 1\n-1 4 0\n"), ("Decreasing", "5 2\n5 4 3 2 1\n")]),
    problem("path", "The cheapest route", "hard", "Find the minimum cost from s to t in a directed weighted graph. Weights are nonnegative. Output the cost, or -1 if t is unreachable. Parallel edges and self-loops are allowed.",
            "First line: n m s t. Next m lines: u v weight. Vertices are numbered 0 to n-1.", "1 ≤ n ≤ 100000; 0 ≤ m ≤ 200000; 0 ≤ weight ≤ 1000000000. Use 64-bit distances. Aim for O((n+m) log n).",
            [("Alternate route", "4 4 0 3\n0 1 5\n0 2 1\n2 1 1\n1 3 2\n"), ("Unreachable", "3 1 0 2\n0 1 4\n"), ("Same vertex", "1 0 0 0\n"), ("Zero cycle", "3 3 0 2\n0 1 0\n1 0 0\n1 2 0\n"), ("Parallel edges", "2 3 0 1\n0 1 8\n0 1 2\n0 0 0\n"), ("Large distance", "4 3 0 3\n0 1 1000000000\n1 2 1000000000\n2 3 1000000000\n")]),
]}


def public_problem(pid):
    p = PROBLEMS[pid]
    return {k: v for k, v in p.items() if k != "cases"} | {"examples": [{k: v for k, v in case.items() if k != "hidden"} for case in p["cases"] if not case["hidden"]], "test_count": len(p["cases"]), "hidden_count": sum(c["hidden"] for c in p["cases"])}
