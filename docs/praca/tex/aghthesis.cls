\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{aghthesis}

\def\titlePL#1        {\gdef\@titlePL{#1}}
\def\titleEN#1        {\gdef\@titleEN{#1}}
\def\fieldofstudy#1   {\gdef\@fieldofstudy{#1}}
\def\supervisor#1   {\gdef\@supervisor{#1}}

% Ustawienia tytułów względem języka pracy

\DeclareOption{polish}
{
	\newcommand*{\LangPrimaryTitle}{\Large \@titlePL}
	\newcommand*{\LangSecondaryTitle}{\@titleEN}
}

\DeclareOption{english}
{
	\newcommand*{\LangPrimaryTitle}{\@titleEN}
	\newcommand*{\LangSecondaryTitle}{\@titlePL}
}

\newcommand*{\LangFaculty}{WYDZIAŁ INŻYNIERII METALI I INFORMATYKI PRZEMYSŁOWEJ}
\def\department#1      {\gdef\@department{#1}}
\def\@department{KATEDRA .....}
\newcommand*{\LangDepartment}{\@department}
\newcommand*{\LangFieldOfStudy}{Kierunek studiów:}
\newcommand*{\LangSupervisor}{Opiekun pracy:}
\newcommand*{\LangAuthor}{Autor:}
\newcommand*{\LangThesisType}{Projekt dyplomowy}

\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}}


% Opcje edycji
\ProcessOptions
\LoadClass[a4paper]{article}


\RequirePackage{setspace}
\RequirePackage{times}
\RequirePackage[T1]{fontenc}
\RequirePackage{graphicx}
\RequirePackage{geometry}
\RequirePackage{xcolor}
\RequirePackage{fancyhdr}
\RequirePackage{titlesec}
\RequirePackage{babel}



\addto\captionspolish{%
  \def\bibname{Bibliografia}%
  \def\refname{Bibliografia}%
  \def\listtablename{Spis tabel}%
  \def\tablename{Tabela}%
}

\geometry{lmargin=20mm, rmargin=20mm, tmargin=25mm, bmargin=25mm, foot=10mm, head=10mm}

\renewcommand{\baselinestretch}{1.5}

\bibliographystyle{plunsrt}

%------------------------------Strona tytułowa------------------------------------


\renewcommand{\maketitle}{%

\newpage \titlepage
\thispagestyle{empty}

\begin{center}

\includegraphics[height=7cm]{Images/agh_logo.pdf}

\vspace*{3mm}

{\small \bfseries\LangFaculty}\\[1mm]
{\small \bfseries\LangDepartment}

\vfill
{\fontsize{18pt}{22pt}\selectfont \LangThesisType}\\
\vspace*{0.8cm}

{\fontsize{18pt}{22pt}\selectfont \itshape\LangPrimaryTitle}\\
\vspace*{0.3cm}

{\fontsize{14pt}{18pt}\selectfont \itshape\LangSecondaryTitle}\\

\end{center}

\vfill

\setlength{\parskip}{0pt}

\begin{tabbing}
    \LangFieldOfStudy\hspace{1cm}\= \kill
    \LangAuthor            \> \@author \\
    \LangFieldOfStudy      \> \@fieldofstudy \\
    \LangSupervisor        \> \@supervisor
\end{tabbing}

\vspace*{15mm}
\begin{center}
{\normalsize Kraków, \@date}
\end{center}

\clearpage
\setcounter{page}{3}

}

%------------------------------------------------------------------------------

\pagestyle{fancy}
\renewcommand{\sectionmark}[1]{\markright{\thesection.\ #1}}
\renewcommand{\headrulewidth}{0.5pt}
\fancyhf{}
\fancyhead{}

\fancyhead[R]{\bfseries \thepage}

\frenchspacing
\sloppy
\widowpenalty     9999
\clubpenalty      9999
\flushbottom

\titleformat{\section}[block]
{\bfseries\Large}{\filright \Large\thesection. }{0ex}{}
\titleformat{\subsection}[block]
{\bfseries\large}{\filright \large\thesubsection. }{0ex}{}
\titleformat{\subsubsection}[block]
{\bfseries\normalsize}{\filright \normalsize\thesubsubsection. }{0ex}{}
