package version

import "fmt"

var (
	Version = "dev"
	Commit  = "unknown"
	Date    = "unknown"
)

type Info struct {
	Version string
	Commit  string
	Date    string
}

func Current() Info {
	return Info{
		Version: Version,
		Commit:  Commit,
		Date:    Date,
	}
}

func (i Info) String() string {
	return fmt.Sprintf("version: %s\ncommit: %s\ndate: %s\n", i.Version, i.Commit, i.Date)
}
