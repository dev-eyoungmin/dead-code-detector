package main

import (
	"fmt"
	"example.com/myapp/pkg/utils"
)

func main() {
	result := utils.FormatName("Alice")
	fmt.Println(result)
	fmt.Println(utils.AppVersion)
}
