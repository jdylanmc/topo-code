use crate::model::{Task, selected};

pub struct Worker;

impl Task for Worker {
    fn run(&self) -> u32 { selected() }
}

pub fn execute() -> u32 {
    Worker.run()
}
