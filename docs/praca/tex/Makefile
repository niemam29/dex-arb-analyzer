.PHONY: all clean check
all: main.pdf

main.pdf: main.tex aghthesis.cls references.bib Chapters/*.tex Figures/*.tex Images/*.png ../../../results/evaluation.tex ../../../results/evaluation-sensitivity.tex extract-listings.py make-figures.py
	python3 extract-listings.py
	pdflatex -interaction=nonstopmode main.tex
	bibtex main
	pdflatex -interaction=nonstopmode main.tex
	pdflatex -interaction=nonstopmode main.tex

clean:
	rm -f main.{aux,bbl,blg,log,out,toc,pdf}

check:
	python3 check.py
