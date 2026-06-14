//go:build ignore

package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

type block struct {
	startLine int
	startCol  int
	endLine   int
	endCol    int
	numStmt   int
	count     int
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: go run ./scripts/merge-coverprofiles.go output input...")
		os.Exit(2)
	}
	mode := ""
	profiles := map[string]map[string]block{}
	for _, path := range os.Args[2:] {
		if err := readProfile(path, &mode, profiles); err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", path, err)
			os.Exit(1)
		}
	}
	if mode == "" {
		fmt.Fprintln(os.Stderr, "no coverage profile data found")
		os.Exit(1)
	}
	if err := writeProfile(os.Args[1], mode, profiles); err != nil {
		fmt.Fprintf(os.Stderr, "write merged profile: %v\n", err)
		os.Exit(1)
	}
}

func readProfile(path string, mode *string, profiles map[string]map[string]block) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "mode: ") {
			profileMode := strings.TrimPrefix(line, "mode: ")
			if *mode == "" {
				*mode = profileMode
			} else if *mode != profileMode {
				return fmt.Errorf("coverage mode mismatch: %s != %s", profileMode, *mode)
			}
			continue
		}
		file, b, err := parseBlock(line)
		if err != nil {
			return fmt.Errorf("line %d: %w", lineNo, err)
		}
		byKey := profiles[file]
		if byKey == nil {
			byKey = map[string]block{}
			profiles[file] = byKey
		}
		key := blockKey(b)
		if existing, ok := byKey[key]; ok {
			if existing.numStmt != b.numStmt {
				return fmt.Errorf("line %d: inconsistent statement count for %s", lineNo, key)
			}
			if b.count > 0 {
				existing.count = 1
			}
			byKey[key] = existing
			continue
		}
		if b.count > 0 {
			b.count = 1
		}
		byKey[key] = b
	}
	return scanner.Err()
}

func parseBlock(line string) (string, block, error) {
	file, rest, ok := strings.Cut(line, ":")
	if !ok {
		return "", block{}, fmt.Errorf("missing file separator")
	}
	rangePart, countPart, ok := strings.Cut(rest, " ")
	if !ok {
		return "", block{}, fmt.Errorf("missing count section")
	}
	rangeStart, rangeEnd, ok := strings.Cut(rangePart, ",")
	if !ok {
		return "", block{}, fmt.Errorf("missing range separator")
	}
	startLine, startCol, err := parsePosition(rangeStart)
	if err != nil {
		return "", block{}, err
	}
	endLine, endCol, err := parsePosition(rangeEnd)
	if err != nil {
		return "", block{}, err
	}
	numStmtRaw, countRaw, ok := strings.Cut(countPart, " ")
	if !ok {
		return "", block{}, fmt.Errorf("missing count")
	}
	numStmt, err := strconv.Atoi(numStmtRaw)
	if err != nil {
		return "", block{}, fmt.Errorf("parse statement count: %w", err)
	}
	count, err := strconv.Atoi(countRaw)
	if err != nil {
		return "", block{}, fmt.Errorf("parse block count: %w", err)
	}
	return file, block{startLine: startLine, startCol: startCol, endLine: endLine, endCol: endCol, numStmt: numStmt, count: count}, nil
}

func parsePosition(raw string) (int, int, error) {
	lineRaw, colRaw, ok := strings.Cut(raw, ".")
	if !ok {
		return 0, 0, fmt.Errorf("missing position separator")
	}
	line, err := strconv.Atoi(lineRaw)
	if err != nil {
		return 0, 0, fmt.Errorf("parse line: %w", err)
	}
	col, err := strconv.Atoi(colRaw)
	if err != nil {
		return 0, 0, fmt.Errorf("parse column: %w", err)
	}
	return line, col, nil
}

func blockKey(b block) string {
	return fmt.Sprintf("%d.%d,%d.%d", b.startLine, b.startCol, b.endLine, b.endCol)
}

func writeProfile(path, mode string, profiles map[string]map[string]block) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := bufio.NewWriter(f)
	if _, err := fmt.Fprintf(w, "mode: %s\n", mode); err != nil {
		return err
	}
	files := make([]string, 0, len(profiles))
	for file := range profiles {
		files = append(files, file)
	}
	sort.Strings(files)
	for _, file := range files {
		blocks := make([]block, 0, len(profiles[file]))
		for _, b := range profiles[file] {
			blocks = append(blocks, b)
		}
		sort.Slice(blocks, func(i, j int) bool {
			if blocks[i].startLine != blocks[j].startLine {
				return blocks[i].startLine < blocks[j].startLine
			}
			if blocks[i].startCol != blocks[j].startCol {
				return blocks[i].startCol < blocks[j].startCol
			}
			if blocks[i].endLine != blocks[j].endLine {
				return blocks[i].endLine < blocks[j].endLine
			}
			return blocks[i].endCol < blocks[j].endCol
		})
		for _, b := range blocks {
			if _, err := fmt.Fprintf(w, "%s:%d.%d,%d.%d %d %d\n", file, b.startLine, b.startCol, b.endLine, b.endCol, b.numStmt, b.count); err != nil {
				return err
			}
		}
	}
	return w.Flush()
}
