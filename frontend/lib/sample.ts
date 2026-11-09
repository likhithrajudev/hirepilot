// Minimal starter that compiles with a stock TeX Live (no extra fonts needed).
export const SAMPLE_RESUME = String.raw`\documentclass[10pt]{article}
\usepackage[margin=0.7in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{titlesec}
\pagestyle{empty}
\titleformat{\section}{\large\bfseries}{}{0pt}{}[\titlerule]
\titlespacing*{\section}{0pt}{8pt}{4pt}
\setlist[itemize]{leftmargin=*, itemsep=1pt, topsep=2pt}

\begin{document}
\begin{center}
  {\LARGE \textbf{Your Name}}\\[2pt]
  you@example.com \quad|\quad \href{https://github.com/you}{github.com/you} \quad|\quad City, ST
\end{center}

\section{Education}
\textbf{University Name} \hfill May 2026\\
B.S. in Computer Science, GPA 3.8

\section{Experience}
\textbf{Software Engineering Intern}, Company \hfill Summer 2025
\begin{itemize}
  \item Built a REST API in Python/FastAPI serving 10k requests/day, backed by PostgreSQL.
  \item Cut p95 latency by 40\% by adding Redis caching to the hottest endpoints.
\end{itemize}

\section{Projects}
\textbf{Project Name} \hfill \href{https://github.com/you/project}{github.com/you/project}
\begin{itemize}
  \item Describe what you built, the stack, and a measurable result.
\end{itemize}

\section{Skills}
\textbf{Languages:} Python, TypeScript, SQL \quad \textbf{Tools:} FastAPI, Docker, AWS, Git
\end{document}
`;
