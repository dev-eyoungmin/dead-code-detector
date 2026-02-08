package utils

import "strings"

const AppVersion = "1.0.0"

const UnusedConst = "never used"

func FormatName(name string) string {
	return capitalize(name)
}

func UnusedFunc() string {
	return "nobody calls me"
}

func capitalize(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

var internalState = 0
