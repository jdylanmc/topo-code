mod model;
mod worker;

pub fn entry() -> u32 {
    worker::execute()
}

pub fn dynamic(task: &dyn model::Task) -> u32 {
    task.run()
}
